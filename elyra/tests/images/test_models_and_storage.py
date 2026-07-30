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
from datetime import timedelta
import json

from cryptography.fernet import Fernet
import pytest

from elyra.images.config import RegistrySettings
from elyra.images.models import ImageBuild
from elyra.images.models import ImageBuildLogEntry
from elyra.images.models import RegistryCredential
from elyra.images.models import RegistryCredentialSummary
from elyra.images.models import redact_secrets
from elyra.images.models import validate_image_reference
from elyra.images.models import workspace_path
from elyra.images.storage import ImageBuildStore
from elyra.images.storage import RegistryCredentialStore

NOW = datetime(2026, 7, 30, 12, 0)


def _build(build_id: str, owner_id: str, created_at: datetime = NOW) -> ImageBuild:
    return ImageBuild(
        id=build_id,
        owner_id=owner_id,
        dockerfile_path="images/Dockerfile",
        context_path="images",
        image_reference="registry.example.com/team/image:latest",
        status="succeeded",
        credential_source="admin",
        created_at=created_at,
    )


def _credential(credential_id: str, owner_id: str) -> RegistryCredential:
    return RegistryCredential(
        id=credential_id,
        owner_id=owner_id,
        display_name="Private registry",
        registry_url="registry.example.com",
        username=owner_id,
        encrypted_token="pending-encryption",
        created_at=NOW,
        updated_at=NOW,
    )


def test_workspace_path_rejects_parent_and_symlink_escape(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    dockerfile = workspace / "images" / "Dockerfile"
    dockerfile.parent.mkdir()
    dockerfile.touch()
    outside = tmp_path / "outside"
    outside.mkdir()
    (workspace / "linked").symlink_to(outside, target_is_directory=True)

    assert workspace_path(workspace, "images/Dockerfile") == dockerfile
    with pytest.raises(ValueError, match="inside"):
        workspace_path(workspace, "../outside/Dockerfile")
    with pytest.raises(ValueError, match="inside"):
        workspace_path(workspace, "linked/Dockerfile")


@pytest.mark.parametrize(
    "image_reference",
    ["image", "UPPERCASE/image:latest", "registry.example.com/image", "registry.example.com/image:"],
)
def test_image_reference_validation_requires_lowercase_name_and_tag(image_reference):
    with pytest.raises(ValueError, match="repository name and tag"):
        validate_image_reference(image_reference)


def test_image_build_and_credential_summary_exclude_token_values():
    build = _build("build-1", "alice")
    summary = _credential("credential-1", "alice").summary()
    serialized = {"build": build.to_dict(), "credential": summary.to_dict()}

    assert validate_image_reference(build.image_reference) == build.image_reference
    assert "encrypted_token" not in serialized["credential"]
    assert "pending-encryption" not in json.dumps(serialized)
    assert redact_secrets("docker login --password secret", ["secret"]) == "docker login --password [REDACTED]"


def test_image_build_requires_a_credential_id_for_user_credentials():
    with pytest.raises(ValueError, match="require credential_id"):
        ImageBuild(
            id="build-1",
            owner_id="alice",
            dockerfile_path="Dockerfile",
            context_path=".",
            image_reference="registry.example.com/team/image:latest",
            status="queued",
            credential_source="user",
            created_at=NOW,
        )


def test_build_store_isolates_builds_logs_and_deletion_by_owner(tmp_path):
    store = ImageBuildStore(tmp_path)
    alice_build = _build("build-1", "alice")
    bob_build = _build("build-1", "bob")
    entry = ImageBuildLogEntry(NOW, "INFO", "Built image")

    store.save(alice_build)
    store.save(bob_build)
    store.append_log(alice_build.id, "alice", entry)

    assert store.list("alice") == [alice_build]
    assert store.get(alice_build.id, "bob") == bob_build
    assert store.logs(alice_build.id, "bob") == []
    assert store.delete(alice_build.id, "alice")
    assert store.get(alice_build.id, "alice") is None
    assert store.get(bob_build.id, "bob") == bob_build


def test_build_store_prunes_expired_records_and_their_logs(tmp_path):
    store = ImageBuildStore(tmp_path)
    store.max_records = 2
    expired = _build("expired", "alice", NOW - timedelta(days=91))
    current_one = _build("current-one", "alice", NOW - timedelta(minutes=2))
    current_two = _build("current-two", "alice", NOW - timedelta(minutes=1))

    store.save(expired, now=NOW)
    store.append_log(expired.id, "alice", ImageBuildLogEntry(NOW, "INFO", "expired build"))
    store.save(current_one, now=NOW)
    store.save(current_two, now=NOW)

    assert {build.id for build in store.list("alice")} == {"current-one", "current-two"}
    assert store.logs(expired.id, "alice") == []


def test_credential_store_encrypts_tokens_and_isolates_users(tmp_path):
    token = "alice-token"
    store = RegistryCredentialStore(Fernet.generate_key().decode("utf-8"), tmp_path)

    summary = store.save(_credential("credential-1", "alice"), token)
    store.save(_credential("credential-1", "bob"), "bob-token")

    assert isinstance(summary, RegistryCredentialSummary)
    assert store.list("alice") == [summary]
    assert store.get_token("credential-1", "alice") == token
    assert store.get_token("credential-1", "bob") == "bob-token"
    assert all(token not in path.read_text(encoding="utf-8") for path in tmp_path.glob("*.json"))
    assert store.delete("credential-1", "alice")
    assert store.get_token("credential-1", "alice") is None
    assert store.get_token("credential-1", "bob") == "bob-token"


def test_credential_store_reports_invalid_master_keys_and_unreadable_tokens(tmp_path):
    with pytest.raises(ValueError, match="master key"):
        RegistryCredentialStore("not-a-fernet-key", tmp_path)

    store = RegistryCredentialStore(Fernet.generate_key().decode("utf-8"), tmp_path)
    store._path("alice").parent.mkdir(parents=True, exist_ok=True)
    store._path("alice").write_text(
        json.dumps([_credential("credential-1", "alice").to_storage_dict()]), encoding="utf-8"
    )
    with pytest.raises(ValueError, match="could not be decrypted"):
        store.get_token("credential-1", "alice")


def test_registry_settings_require_complete_administrator_credential():
    settings = RegistrySettings()

    assert not settings.has_admin_credential()
    settings.admin_registry_url = "registry.example.com"
    settings.admin_username = "admin"
    settings.admin_token = "admin-token"
    assert settings.has_admin_credential()
