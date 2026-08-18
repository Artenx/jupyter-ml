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
"""Validated models shared by Dockerfile image build services and handlers."""

from __future__ import annotations

from dataclasses import asdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import re
from typing import Any
from typing import ClassVar
from typing import Dict
from typing import Iterable
from typing import Optional

_IMAGE_REFERENCE_PATTERN = re.compile(
    r"^(?=.{1,255}$)(?:[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/)?"
    r"[a-z0-9]+(?:[._-][a-z0-9]+)*(?:/[a-z0-9]+(?:[._-][a-z0-9]+)*)*"
    r":[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$"
)


def workspace_path(root_dir: str | Path, requested_path: str) -> Path:
    """Resolve a Dockerfile path and require it to remain inside the workspace."""
    if not isinstance(requested_path, str) or not requested_path.strip():
        raise ValueError("Dockerfile path must be a non-empty string.")
    root_path = Path(root_dir).resolve()
    candidate = (root_path / requested_path).resolve()
    try:
        candidate.relative_to(root_path)
    except ValueError as exc:
        raise ValueError("Dockerfile path must be inside the Jupyter Server workspace.") from exc
    return candidate


def validate_image_reference(image_reference: str) -> str:
    """Validate a Docker image reference that includes a repository and tag."""
    if not isinstance(image_reference, str) or not _IMAGE_REFERENCE_PATTERN.fullmatch(image_reference):
        raise ValueError("Image reference must include a lowercase repository name and tag.")
    return image_reference


def redact_secrets(value: str, secrets: Iterable[Optional[str]]) -> str:
    """Replace known credential values before persisting build output."""
    redacted = value
    for secret in secrets:
        if secret:
            redacted = redacted.replace(secret, "[REDACTED]")
    return redacted


def _datetime_from_string(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


def _datetime_to_string(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


@dataclass
class RegistryCredentialSummary:
    """Credential metadata safe to expose through the authenticated API."""

    id: str
    display_name: str
    registry_url: str
    username: str
    updated_at: datetime
    source: str = "user"

    VALID_SOURCES: ClassVar[set[str]] = {"admin", "user"}

    def __post_init__(self) -> None:
        if self.source not in self.VALID_SOURCES:
            raise ValueError(f"Unsupported registry credential source '{self.source}'.")
        for field_name, value in (
            ("id", self.id),
            ("display_name", self.display_name),
            ("registry_url", self.registry_url),
            ("username", self.username),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"Registry credential {field_name} must be a non-empty string.")

    def to_dict(self) -> Dict[str, Any]:
        value = asdict(self)
        value["updated_at"] = _datetime_to_string(self.updated_at)
        return value


@dataclass
class RegistryCredential:
    """Persistent user-owned credential with an encrypted access token."""

    id: str
    owner_id: str
    display_name: str
    registry_url: str
    username: str
    encrypted_token: str
    created_at: datetime
    updated_at: datetime

    def __post_init__(self) -> None:
        if not self.owner_id:
            raise ValueError("Registry credential owner_id must be non-empty.")
        if not self.encrypted_token:
            raise ValueError("Registry credential encrypted_token must be non-empty.")
        RegistryCredentialSummary(
            id=self.id,
            display_name=self.display_name,
            registry_url=self.registry_url,
            username=self.username,
            updated_at=self.updated_at,
        )

    def summary(self) -> RegistryCredentialSummary:
        return RegistryCredentialSummary(
            id=self.id,
            display_name=self.display_name,
            registry_url=self.registry_url,
            username=self.username,
            updated_at=self.updated_at,
        )

    def to_storage_dict(self) -> Dict[str, Any]:
        value = asdict(self)
        value["created_at"] = _datetime_to_string(self.created_at)
        value["updated_at"] = _datetime_to_string(self.updated_at)
        return value

    @classmethod
    def from_storage_dict(cls, value: Dict[str, Any]) -> "RegistryCredential":
        return cls(
            id=value["id"],
            owner_id=value["owner_id"],
            display_name=value["display_name"],
            registry_url=value["registry_url"],
            username=value["username"],
            encrypted_token=value["encrypted_token"],
            created_at=_datetime_from_string(value["created_at"]),
            updated_at=_datetime_from_string(value["updated_at"]),
        )


@dataclass
class ImageBuild:
    """A user-owned Docker build and push lifecycle record."""

    id: str
    owner_id: str
    dockerfile_path: str
    context_path: str
    image_reference: str
    status: str
    credential_source: str
    created_at: datetime
    credential_id: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_summary: Optional[str] = None
    log_path: Optional[str] = None

    VALID_STATUSES: ClassVar[set[str]] = {"queued", "running", "succeeded", "failed", "stopped", "pushing", "pushed"}
    VALID_CREDENTIAL_SOURCES: ClassVar[set[str]] = {"admin", "user"}

    def __post_init__(self) -> None:
        if not self.id or not self.owner_id:
            raise ValueError("Image build id and owner_id must be non-empty.")
        if self.status not in self.VALID_STATUSES:
            raise ValueError(f"Unsupported image build status '{self.status}'.")
        if self.credential_source not in self.VALID_CREDENTIAL_SOURCES:
            raise ValueError(f"Unsupported image build credential source '{self.credential_source}'.")
        if self.credential_source == "user" and not self.credential_id:
            raise ValueError("User image build credentials require credential_id.")
        validate_image_reference(self.image_reference)

    def to_dict(self) -> Dict[str, Any]:
        value = asdict(self)
        for field_name in ("created_at", "started_at", "finished_at"):
            value[field_name] = _datetime_to_string(value[field_name])
        return value

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "ImageBuild":
        return cls(
            id=value["id"],
            owner_id=value["owner_id"],
            dockerfile_path=value["dockerfile_path"],
            context_path=value["context_path"],
            image_reference=value["image_reference"],
            status=value["status"],
            credential_source=value["credential_source"],
            credential_id=value.get("credential_id"),
            created_at=_datetime_from_string(value["created_at"]),
            started_at=_datetime_from_string(value.get("started_at")),
            finished_at=_datetime_from_string(value.get("finished_at")),
            error_summary=value.get("error_summary"),
            log_path=value.get("log_path"),
        )


@dataclass
class ImageBuildLogEntry:
    """One timestamped, already-redacted Docker CLI output line."""

    timestamp: datetime
    level: str
    message: str

    def to_dict(self) -> Dict[str, Any]:
        value = asdict(self)
        value["timestamp"] = _datetime_to_string(self.timestamp)
        return value

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "ImageBuildLogEntry":
        return cls(timestamp=_datetime_from_string(value["timestamp"]), level=value["level"], message=value["message"])
