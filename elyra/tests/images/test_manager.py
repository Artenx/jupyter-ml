#
# Copyright 2018-2026 Elyra Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
from datetime import datetime
from io import StringIO

from cryptography.fernet import Fernet
import pytest

from elyra.images.config import RegistrySettings
from elyra.images.manager import ImageBuildManager
from elyra.images.models import ImageBuild
from elyra.images.models import RegistryCredential
from elyra.images.storage import ImageBuildStore
from elyra.images.storage import RegistryCredentialStore
from elyra.metadata.error import MetadataNotFoundError


class FakeProcess:
    """Minimal Docker CLI process substitute with deterministic output."""

    def __init__(self, output: str = "", returncode: int = 0):
        self._output = output
        self._expected_returncode = returncode
        self.returncode = None
        self.stdout = StringIO(output)
        self.input = None
        self.terminated = False

    def communicate(self, value: str):
        self.input = value
        self.returncode = self._expected_returncode
        return self._output, ""

    def wait(self):
        self.returncode = self._expected_returncode
        return self.returncode

    def poll(self):
        return self.returncode

    def terminate(self):
        self.terminated = True
        self.returncode = -15


class RuntimeImageManagerStub:
    def __init__(self, exists: bool = False):
        self.exists = exists
        self.created = []
        self.updated = []

    def get(self, name):
        if not self.exists:
            raise MetadataNotFoundError("runtime-images", name)
        return object()

    def create(self, name, metadata):
        self.created.append((name, metadata))
        return metadata

    def update(self, name, metadata):
        self.updated.append((name, metadata))
        return metadata


def _settings() -> RegistrySettings:
    settings = RegistrySettings()
    settings.admin_registry_url = "registry.example.com"
    settings.admin_username = "admin"
    settings.admin_token = "admin-token"
    settings.credential_master_key = Fernet.generate_key().decode("utf-8")
    return settings


def _credential() -> RegistryCredential:
    now = datetime.now()
    return RegistryCredential(
        id="private-registry",
        owner_id="alice",
        display_name="Private registry",
        registry_url="private.example.com",
        username="alice",
        encrypted_token="pending-encryption",
        created_at=now,
        updated_at=now,
    )


def _build(status: str = "succeeded", credential_source: str = "admin") -> ImageBuild:
    return ImageBuild(
        id="build-1",
        owner_id="alice",
        dockerfile_path="images/Dockerfile",
        context_path="images",
        image_reference="registry.example.com/team/image:latest",
        status=status,
        credential_source=credential_source,
        credential_id="private-registry" if credential_source == "user" else None,
        created_at=datetime.now(),
    )


@pytest.fixture
def manager(tmp_path):
    workspace = tmp_path / "workspace"
    dockerfile = workspace / "images" / "Dockerfile"
    dockerfile.parent.mkdir(parents=True)
    dockerfile.write_text("FROM python:3.12", encoding="utf-8")
    manager = ImageBuildManager(
        str(workspace), build_store=ImageBuildStore(tmp_path / "storage"), registry_settings=_settings()
    )
    manager._submit = lambda *_: None
    yield manager
    manager.stop()


def test_build_command_transitions_to_succeeded_and_collects_output(manager, monkeypatch):
    calls = []
    process = FakeProcess("Step 1/1 : FROM python:3.12\nSuccessfully built image\n")
    monkeypatch.setattr(
        "elyra.images.manager.subprocess.Popen", lambda command, **kwargs: calls.append((command, kwargs)) or process
    )

    build = manager.start_build("alice", "images/Dockerfile", "registry.example.com/team/image:latest")
    manager._run_build(build.id, "alice")

    assert calls[0][0] == [
        "docker",
        "build",
        "--tag",
        "registry.example.com/team/image:latest",
        "--file",
        str(manager.root_dir / "images" / "Dockerfile"),
        str(manager.root_dir / "images"),
    ]
    assert manager.build_store.get(build.id, "alice").status == "succeeded"
    assert [entry.message for entry in manager.build_store.logs(build.id, "alice")] == [
        "Step 1/1 : FROM python:3.12",
        "Successfully built image",
    ]


def test_admin_push_uses_password_stdin_and_redacts_logs(manager, monkeypatch):
    calls = []
    login = FakeProcess("Login Succeeded for admin-token\n")
    push = FakeProcess("Pushed registry.example.com/team/image:latest\n")
    processes = [login, push]
    monkeypatch.setattr(
        "elyra.images.manager.subprocess.Popen",
        lambda command, **kwargs: calls.append((command, kwargs)) or processes.pop(0),
    )
    build = _build()
    manager.build_store.save(build)

    manager.push_build(build.id, "alice")
    manager._run_push(build.id, "alice")

    assert calls[0][0] == ["docker", "login", "registry.example.com", "--username", "admin", "--password-stdin"]
    assert login.input == "admin-token\n"
    assert calls[1][0] == ["docker", "push", build.image_reference]
    assert manager.build_store.get(build.id, "alice").status == "pushed"
    assert "admin-token" not in "\n".join(entry.message for entry in manager.build_store.logs(build.id, "alice"))


def test_personal_push_uses_the_owner_credential(manager, monkeypatch):
    calls = []
    credential_store = RegistryCredentialStore(
        manager.registry_settings.credential_master_key, manager.root_dir / "credentials"
    )
    credential_store.save(_credential(), "personal-token")
    manager._credential_store = credential_store
    processes = [FakeProcess(), FakeProcess()]
    monkeypatch.setattr(
        "elyra.images.manager.subprocess.Popen",
        lambda command, **kwargs: calls.append(command) or processes.pop(0),
    )
    build = _build(credential_source="user")
    manager.build_store.save(build)

    manager.push_build(build.id, "alice")
    manager._run_push(build.id, "alice")

    assert calls[0] == ["docker", "login", "private.example.com", "--username", "alice", "--password-stdin"]


def test_failed_docker_command_redacts_token_and_preserves_failure(manager, monkeypatch):
    process = FakeProcess("denied: personal-token\n", returncode=1)
    monkeypatch.setattr("elyra.images.manager.subprocess.Popen", lambda *_args, **_kwargs: process)
    build = _build(status="pushing")
    manager.build_store.save(build)

    assert not manager._run_docker_command(
        build, ["docker", "push", build.image_reference], "pushed", secrets=["personal-token"]
    )

    stored = manager.build_store.get(build.id, "alice")
    assert stored.status == "failed"
    assert "personal-token" not in stored.error_summary
    assert "personal-token" not in "\n".join(entry.message for entry in manager.build_store.logs(build.id, "alice"))


def test_stop_request_terminates_only_the_owned_active_process(manager):
    process = FakeProcess()
    build = _build(status="running")
    manager.build_store.save(build)
    manager._processes[("alice", build.id)] = process

    assert manager.stop_build(build.id, "alice")
    assert process.terminated
    assert manager.build_store.get(build.id, "alice").status == "stopped"
    assert not manager.stop_build(build.id, "bob")


def test_runtime_image_registration_creates_or_updates_only_pushed_builds(manager):
    build = _build(status="pushed")
    manager.build_store.save(build)
    runtime_manager = RuntimeImageManagerStub()
    manager._runtime_image_manager = runtime_manager

    created = manager.register_runtime_image(build.id, "alice", "Team image", "Published image")
    assert created.metadata == {
        "image_name": build.image_reference,
        "pull_policy": "IfNotPresent",
        "description": "Published image",
    }
    assert len(runtime_manager.created) == 1

    runtime_manager.exists = True
    manager.register_runtime_image(build.id, "alice", "Updated image")
    assert len(runtime_manager.updated) == 1

    build.status = "succeeded"
    manager.build_store.save(build)
    with pytest.raises(ValueError, match="pushed"):
        manager.register_runtime_image(build.id, "alice", "Team image")
