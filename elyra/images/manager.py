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
"""Docker CLI build and push lifecycle management."""

from __future__ import annotations

from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from typing import Optional
from uuid import uuid4

from elyra.images.config import RegistrySettings
from elyra.images.models import ImageBuild
from elyra.images.models import ImageBuildLogEntry
from elyra.images.models import redact_secrets
from elyra.images.models import workspace_path
from elyra.images.storage import ImageBuildStore
from elyra.images.storage import RegistryCredentialStore
from elyra.metadata.error import MetadataNotFoundError
from elyra.metadata.manager import MetadataManager
from elyra.metadata.metadata import Metadata
from elyra.metadata.schemaspaces import RuntimeImages


class ImageBuildManager:
    """Executes user-owned Docker builds and pushes through the local Docker CLI."""

    def __init__(
        self,
        root_dir: str,
        build_store: Optional[ImageBuildStore] = None,
        credential_store: Optional[RegistryCredentialStore] = None,
        registry_settings: Optional[RegistrySettings] = None,
        runtime_image_manager: Optional[MetadataManager] = None,
    ):
        self.root_dir = Path(root_dir).resolve()
        self.build_store = build_store or ImageBuildStore()
        self._credential_store = credential_store
        self.registry_settings = registry_settings or RegistrySettings()
        self._runtime_image_manager = runtime_image_manager
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="elyra-image-build")
        self._futures: dict[tuple[str, str], Future] = {}
        self._processes: dict[tuple[str, str], subprocess.Popen] = {}
        self._lock = threading.Lock()

    @property
    def credential_store(self) -> RegistryCredentialStore:
        """Create encrypted credential storage only when a user credential is needed."""
        if self._credential_store is None:
            self._credential_store = RegistryCredentialStore(self.registry_settings.credential_master_key)
        return self._credential_store

    def start_build(
        self,
        owner_id: str,
        dockerfile_path: str,
        image_reference: str,
        credential_source: str = "admin",
        credential_id: Optional[str] = None,
    ) -> ImageBuild:
        """Validate and queue a Docker image build for one authenticated user."""
        dockerfile = workspace_path(self.root_dir, dockerfile_path)
        if not dockerfile.is_file():
            raise ValueError(f"Dockerfile '{dockerfile_path}' was not found in the workspace.")
        if credential_source == "user" and (
            credential_id is None or self.credential_store.get(credential_id, owner_id) is None
        ):
            raise ValueError("Selected personal registry credential was not found.")

        build = ImageBuild(
            id=str(uuid4()),
            owner_id=owner_id,
            dockerfile_path=str(dockerfile.relative_to(self.root_dir)),
            context_path=str(dockerfile.parent.relative_to(self.root_dir)),
            image_reference=image_reference,
            status="queued",
            credential_source=credential_source,
            credential_id=credential_id,
            created_at=datetime.now(),
        )
        self.build_store.save(build)
        self._submit(build, self._run_build)
        return build

    def read_dockerfile(self, dockerfile_path: str) -> str:
        """Read a workspace Dockerfile after resolving it within the server root."""
        dockerfile = workspace_path(self.root_dir, dockerfile_path)
        if not dockerfile.is_file():
            raise FileNotFoundError(f"Dockerfile '{dockerfile_path}' was not found in the workspace.")
        return dockerfile.read_text(encoding="utf-8")

    def create_dockerfile(self, dockerfile_path: str, content: str = "") -> Path:
        """Create a new Dockerfile without replacing an existing workspace file."""
        dockerfile = workspace_path(self.root_dir, dockerfile_path)
        if dockerfile.exists():
            raise ValueError(f"Dockerfile '{dockerfile_path}' already exists.")
        self._write_dockerfile(dockerfile, content)
        return dockerfile

    def save_dockerfile(self, dockerfile_path: str, content: str) -> Path:
        """Atomically save Dockerfile content inside the configured workspace."""
        dockerfile = workspace_path(self.root_dir, dockerfile_path)
        self._write_dockerfile(dockerfile, content)
        return dockerfile

    def register_runtime_image(
        self,
        build_id: str,
        owner_id: str,
        display_name: str,
        description: Optional[str] = None,
    ) -> Metadata:
        """Create or update a Runtime Image only after the user push has completed."""
        build = self._owned_build(build_id, owner_id)
        if build.status != "pushed":
            raise ValueError("Only a pushed image build can be registered as a Runtime Image.")
        if not isinstance(display_name, str) or not display_name.strip():
            raise ValueError("Runtime Image display name must be a non-empty string.")

        image_name = build.image_reference
        metadata_name = f"image_{hashlib.sha256(image_name.encode('utf-8')).hexdigest()[:16]}"
        properties = {"image_name": image_name, "pull_policy": "IfNotPresent"}
        if description:
            properties["description"] = description
        runtime_image = Metadata(
            name=metadata_name,
            display_name=display_name.strip(),
            schema_name="runtime-image",
            metadata=properties,
        )
        try:
            self.runtime_image_manager.get(metadata_name)
        except MetadataNotFoundError:
            return self.runtime_image_manager.create(metadata_name, runtime_image)
        return self.runtime_image_manager.update(metadata_name, runtime_image)

    def push_build(self, build_id: str, owner_id: str) -> ImageBuild:
        """Queue a push for a successful user-owned image build."""
        build = self._owned_build(build_id, owner_id)
        if build.status != "succeeded":
            raise ValueError("Only a successful image build can be pushed.")
        build.status = "pushing"
        build.started_at = datetime.now()
        build.finished_at = None
        build.error_summary = None
        self.build_store.save(build)
        self._submit(build, self._run_push)
        return build

    def stop_build(self, build_id: str, owner_id: str) -> bool:
        """Terminate an active Docker command owned by the requesting user."""
        build = self.build_store.get(build_id, owner_id)
        if build is None or build.status not in {"queued", "running", "pushing"}:
            return False
        key = (owner_id, build_id)
        with self._lock:
            future = self._futures.get(key)
            process = self._processes.get(key)
            if future and future.cancel():
                self._futures.pop(key, None)
            if process and process.poll() is None:
                process.terminate()
        build.status = "stopped"
        build.finished_at = datetime.now()
        self.build_store.save(build)
        self._append_log(build, "INFO", "Docker command stop requested.")
        return True

    def stop(self) -> None:
        """Stop active Docker commands and wait for managed build workers."""
        with self._lock:
            active_keys = set(self._futures) | set(self._processes)
            processes = list(self._processes.values())
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for owner_id, build_id in active_keys:
            build = self.build_store.get(build_id, owner_id)
            if build and build.status in {"queued", "running", "pushing"}:
                build.status = "stopped"
                build.finished_at = datetime.now()
                self.build_store.save(build)
                self._append_log(build, "INFO", "Jupyter Server stopped the Docker command.")
        self._executor.shutdown(wait=True)

    def _submit(self, build: ImageBuild, worker) -> None:
        key = (build.owner_id, build.id)
        with self._lock:
            self._futures[key] = self._executor.submit(worker, build.id, build.owner_id)

    @property
    def runtime_image_manager(self) -> MetadataManager:
        """Get the Runtime Images metadata manager after Jupyter schema initialization."""
        if self._runtime_image_manager is None:
            self._runtime_image_manager = MetadataManager(schemaspace=RuntimeImages.RUNTIME_IMAGES_SCHEMASPACE_ID)
        return self._runtime_image_manager

    def _write_dockerfile(self, dockerfile: Path, content: str) -> None:
        if not isinstance(content, str):
            raise ValueError("Dockerfile content must be a string.")
        dockerfile.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=dockerfile.parent, prefix="Dockerfile-", suffix=".tmp", delete=False
        ) as file:
            file.write(content)
            temporary_path = file.name
        os.replace(temporary_path, dockerfile)

    def _run_build(self, build_id: str, owner_id: str) -> None:
        build = self._owned_build(build_id, owner_id)
        if build.status == "stopped":
            return
        build.status = "running"
        build.started_at = datetime.now()
        self.build_store.save(build)
        dockerfile = workspace_path(self.root_dir, build.dockerfile_path)
        self._run_docker_command(
            build,
            ["docker", "build", "--tag", build.image_reference, "--file", str(dockerfile), str(dockerfile.parent)],
            "succeeded",
        )

    def _run_push(self, build_id: str, owner_id: str) -> None:
        build = self._owned_build(build_id, owner_id)
        if build.status == "stopped":
            return
        try:
            registry_url, username, token = self._credentials_for(build)
        except ValueError as exc:
            self._fail(build, str(exc))
            return
        if not self._run_docker_command(
            build,
            ["docker", "login", registry_url, "--username", username, "--password-stdin"],
            None,
            token=token,
        ):
            return
        self._run_docker_command(build, ["docker", "push", build.image_reference], "pushed", secrets=[token])

    def _credentials_for(self, build: ImageBuild) -> tuple[str, str, str]:
        if build.credential_source == "admin":
            if not self.registry_settings.has_admin_credential():
                raise ValueError("Administrator registry credentials are not configured.")
            return (
                self.registry_settings.admin_registry_url,
                self.registry_settings.admin_username,
                self.registry_settings.admin_token,
            )
        if build.credential_id is None:
            raise ValueError("A personal registry credential is required for this build.")
        credential = self.credential_store.get(build.credential_id, build.owner_id)
        token = self.credential_store.get_token(build.credential_id, build.owner_id)
        if credential is None or token is None:
            raise ValueError("Selected personal registry credential was not found.")
        return credential.registry_url, credential.username, token

    def _run_docker_command(
        self,
        build: ImageBuild,
        command: list[str],
        success_status: Optional[str],
        token: Optional[str] = None,
        secrets: Optional[list[str]] = None,
    ) -> bool:
        sensitive_values = [*(secrets or []), token]
        key = (build.owner_id, build.id)
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE if token else None,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
        except (FileNotFoundError, PermissionError, OSError) as exc:
            self._fail(build, f"Docker CLI could not start: {exc}", sensitive_values)
            return False
        with self._lock:
            self._processes[key] = process
        try:
            if token:
                output, _ = process.communicate(f"{token}\n")
                for line in output.splitlines():
                    self._append_log(build, "INFO", redact_secrets(line, sensitive_values))
            else:
                assert process.stdout is not None
                for line in process.stdout:
                    self._append_log(build, "INFO", redact_secrets(line.rstrip(), sensitive_values))
                process.wait()
        finally:
            with self._lock:
                self._processes.pop(key, None)
        current = self.build_store.get(build.id, build.owner_id)
        if current is None or current.status == "stopped":
            return False
        if process.returncode == 0:
            if success_status:
                current.status = success_status
                current.finished_at = datetime.now()
                self.build_store.save(current)
            return True
        self._fail(current, f"Docker command exited with status {process.returncode}.", sensitive_values)
        return False

    def _append_log(self, build: ImageBuild, level: str, message: str) -> None:
        self.build_store.append_log(build.id, build.owner_id, ImageBuildLogEntry(datetime.now(), level, message))

    def _fail(self, build: ImageBuild, message: str, secrets: Optional[list[Optional[str]]] = None) -> None:
        current = self.build_store.get(build.id, build.owner_id)
        if current is None or current.status == "stopped":
            return
        current.status = "failed"
        current.finished_at = datetime.now()
        current.error_summary = redact_secrets(message, secrets or [])
        self.build_store.save(current)
        self._append_log(current, "ERROR", current.error_summary)

    def _owned_build(self, build_id: str, owner_id: str) -> ImageBuild:
        build = self.build_store.get(build_id, owner_id)
        if build is None:
            raise ValueError(f"Image build '{build_id}' was not found.")
        return build
