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
"""User-isolated persistence for Dockerfile image builds and credentials."""

from __future__ import annotations

from datetime import datetime
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path
import tempfile
from typing import Iterable
from typing import List
from typing import Optional

from cryptography.fernet import Fernet
from cryptography.fernet import InvalidToken
import jupyter_core.paths

from elyra.images.models import ImageBuild
from elyra.images.models import ImageBuildLogEntry
from elyra.images.models import RegistryCredential
from elyra.images.models import RegistryCredentialSummary


def _owner_storage_name(owner_id: str) -> str:
    if not isinstance(owner_id, str) or not owner_id:
        raise ValueError("Resource owner_id must be a non-empty string.")
    return hashlib.sha256(owner_id.encode("utf-8")).hexdigest()


def _write_json(path: Path, values: Iterable[dict]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f"{path.stem}-", suffix=".tmp", delete=False
    ) as file:
        json.dump(list(values), file, indent=2)
        temporary_path = file.name
    os.replace(temporary_path, path)
    path.chmod(0o600)


class ImageBuildStore:
    """Persists build records and logs in per-user files under Jupyter data."""

    max_records = 100
    retention_days = 90

    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or Path(jupyter_core.paths.jupyter_data_dir()) / "metadata" / "image-builds"
        self.builds_dir = self.storage_dir / "builds"
        self.logs_dir = self.storage_dir / "logs"

    def list(self, owner_id: str) -> List[ImageBuild]:
        path = self._builds_path(owner_id)
        if not path.exists():
            return []
        with path.open(encoding="utf-8") as file:
            return sorted(
                [ImageBuild.from_dict(value) for value in json.load(file)],
                key=lambda build: build.created_at,
                reverse=True,
            )

    def get(self, build_id: str, owner_id: str) -> Optional[ImageBuild]:
        return next((build for build in self.list(owner_id) if build.id == build_id), None)

    def save(self, build: ImageBuild, now: Optional[datetime] = None) -> ImageBuild:
        builds = self.list(build.owner_id)
        for index, current in enumerate(builds):
            if current.id == build.id:
                builds[index] = build
                self._write_builds(build.owner_id, self._prune(builds, now or datetime.now()))
                return build
        builds.append(build)
        self._write_builds(build.owner_id, self._prune(builds, now or datetime.now()))
        return build

    def delete(self, build_id: str, owner_id: str) -> bool:
        builds = self.list(owner_id)
        remaining = [build for build in builds if build.id != build_id]
        if len(remaining) == len(builds):
            return False
        self._write_builds(owner_id, remaining)
        log_path = self._log_path(owner_id, build_id)
        if log_path.exists():
            log_path.unlink()
        return True

    def append_log(self, build_id: str, owner_id: str, entry: ImageBuildLogEntry) -> None:
        if self.get(build_id, owner_id) is None:
            raise ValueError(f"Image build '{build_id}' was not found.")
        log_path = self._log_path(owner_id, build_id)
        log_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(entry.to_dict()) + "\n")
        log_path.chmod(0o600)

    def logs(self, build_id: str, owner_id: str) -> List[ImageBuildLogEntry]:
        if self.get(build_id, owner_id) is None:
            return []
        log_path = self._log_path(owner_id, build_id)
        if not log_path.exists():
            return []
        with log_path.open(encoding="utf-8") as file:
            return [ImageBuildLogEntry.from_dict(json.loads(line)) for line in file if line.strip()]

    def _builds_path(self, owner_id: str) -> Path:
        return self.builds_dir / f"{_owner_storage_name(owner_id)}.json"

    def _log_path(self, owner_id: str, build_id: str) -> Path:
        return (
            self.logs_dir
            / _owner_storage_name(owner_id)
            / f"{hashlib.sha256(build_id.encode('utf-8')).hexdigest()}.jsonl"
        )

    def _write_builds(self, owner_id: str, builds: Iterable[ImageBuild]) -> None:
        _write_json(self._builds_path(owner_id), (build.to_dict() for build in builds))

    def _prune(self, builds: Iterable[ImageBuild], now: datetime) -> List[ImageBuild]:
        cutoff = now - timedelta(days=self.retention_days)
        retained: List[ImageBuild] = []
        for build in sorted(builds, key=lambda current: current.created_at, reverse=True):
            active = build.status in {"queued", "running", "pushing"}
            if active or len(retained) < self.max_records or build.created_at >= cutoff:
                retained.append(build)
            else:
                log_path = self._log_path(build.owner_id, build.id)
                if log_path.exists():
                    log_path.unlink()
        return retained


class RegistryCredentialStore:
    """Persists user registry credentials with Fernet-encrypted access tokens."""

    def __init__(self, master_key: str, storage_dir: Optional[Path] = None):
        if not master_key:
            raise ValueError("Registry credential master key must be configured.")
        try:
            self._fernet = Fernet(master_key.encode("utf-8"))
        except (TypeError, ValueError) as exc:
            raise ValueError("Registry credential master key must be a valid Fernet key.") from exc
        self.storage_dir = (
            storage_dir or Path(jupyter_core.paths.jupyter_data_dir()) / "metadata" / "image-builds" / "credentials"
        )

    def list(self, owner_id: str) -> List[RegistryCredentialSummary]:
        return [credential.summary() for credential in self._credentials(owner_id)]

    def get(self, credential_id: str, owner_id: str) -> Optional[RegistryCredentialSummary]:
        credential = self._get_credential(credential_id, owner_id)
        return credential.summary() if credential else None

    def get_record(self, credential_id: str, owner_id: str) -> Optional[RegistryCredential]:
        """Return an owned encrypted credential for server-side update operations."""
        return self._get_credential(credential_id, owner_id)

    def get_token(self, credential_id: str, owner_id: str) -> Optional[str]:
        credential = self._get_credential(credential_id, owner_id)
        if credential is None:
            return None
        try:
            return self._fernet.decrypt(credential.encrypted_token.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise ValueError(f"Registry credential '{credential_id}' could not be decrypted.") from exc

    def save(self, credential: RegistryCredential, token: str) -> RegistryCredentialSummary:
        if not token:
            raise ValueError("Registry credential token must be a non-empty string.")
        encrypted_credential = RegistryCredential(
            id=credential.id,
            owner_id=credential.owner_id,
            display_name=credential.display_name,
            registry_url=credential.registry_url,
            username=credential.username,
            encrypted_token=self._fernet.encrypt(token.encode("utf-8")).decode("utf-8"),
            created_at=credential.created_at,
            updated_at=credential.updated_at,
        )
        credentials = self._credentials(credential.owner_id)
        for index, current in enumerate(credentials):
            if current.id == credential.id:
                credentials[index] = encrypted_credential
                self._write(credential.owner_id, credentials)
                return encrypted_credential.summary()
        credentials.append(encrypted_credential)
        self._write(credential.owner_id, credentials)
        return encrypted_credential.summary()

    def delete(self, credential_id: str, owner_id: str) -> bool:
        credentials = self._credentials(owner_id)
        remaining = [credential for credential in credentials if credential.id != credential_id]
        if len(remaining) == len(credentials):
            return False
        self._write(owner_id, remaining)
        return True

    def _credentials(self, owner_id: str) -> List[RegistryCredential]:
        path = self._path(owner_id)
        if not path.exists():
            return []
        with path.open(encoding="utf-8") as file:
            credentials = [RegistryCredential.from_storage_dict(value) for value in json.load(file)]
        return [credential for credential in credentials if credential.owner_id == owner_id]

    def _get_credential(self, credential_id: str, owner_id: str) -> Optional[RegistryCredential]:
        return next((credential for credential in self._credentials(owner_id) if credential.id == credential_id), None)

    def _path(self, owner_id: str) -> Path:
        return self.storage_dir / f"{_owner_storage_name(owner_id)}.json"

    def _write(self, owner_id: str, credentials: Iterable[RegistryCredential]) -> None:
        _write_json(self._path(owner_id), (credential.to_storage_dict() for credential in credentials))
