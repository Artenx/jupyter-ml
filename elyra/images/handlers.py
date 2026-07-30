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
"""Authenticated REST handlers for Dockerfile image build operations."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from typing import Dict
from uuid import uuid4

from jupyter_server.base.handlers import APIHandler
from tornado import web

from elyra.images.manager import ImageBuildManager
from elyra.images.models import RegistryCredential
from elyra.images.models import RegistryCredentialSummary
from elyra.util.http import HttpErrorMixin


class ImageBuildBaseHandler(HttpErrorMixin, APIHandler):
    """Common authenticated owner and payload helpers for image build endpoints."""

    @property
    def manager(self) -> ImageBuildManager:
        return self.settings["elyra_image_build_manager"]

    @property
    def owner_id(self) -> str:
        user = self.current_user
        if isinstance(user, dict):
            return str(user.get("name") or user.get("username"))
        return str(getattr(user, "username", user))

    def payload(self) -> Dict[str, Any]:
        payload = self.get_json_body()
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="Request body must be a JSON object.")
        return payload

    @staticmethod
    def require_string(payload: Dict[str, Any], field_name: str) -> str:
        value = payload.get(field_name)
        if not isinstance(value, str) or not value.strip():
            raise web.HTTPError(400, reason=f"{field_name} must be a non-empty string.")
        return value.strip()

    def owned_build(self, build_id: str):
        build = self.manager.build_store.get(build_id, self.owner_id)
        if build is None:
            raise web.HTTPError(404, reason=f"Image build '{build_id}' was not found.")
        return build

    def value_error(self, error: ValueError) -> web.HTTPError:
        return web.HTTPError(400, reason=str(error))


class DockerfileHandler(ImageBuildBaseHandler):
    """Read, create, and save Dockerfiles within the Jupyter workspace."""

    @web.authenticated
    async def get(self) -> None:
        path = self.get_query_argument("path", default=None)
        if not path:
            raise web.HTTPError(400, reason="path query argument is required.")
        try:
            self.finish({"path": path, "content": self.manager.read_dockerfile(path)})
        except FileNotFoundError as exc:
            raise web.HTTPError(404, reason=str(exc)) from exc
        except ValueError as exc:
            raise self.value_error(exc) from exc

    @web.authenticated
    async def post(self) -> None:
        payload = self.payload()
        path = self.require_string(payload, "path")
        content = payload.get("content", "")
        try:
            dockerfile = self.manager.create_dockerfile(path, content)
        except ValueError as exc:
            raise self.value_error(exc) from exc
        self.set_status(201)
        self.finish({"path": str(dockerfile.relative_to(self.manager.root_dir)), "content": content})

    @web.authenticated
    async def put(self) -> None:
        payload = self.payload()
        path = self.require_string(payload, "path")
        content = payload.get("content")
        try:
            dockerfile = self.manager.save_dockerfile(path, content)
        except ValueError as exc:
            raise self.value_error(exc) from exc
        self.finish({"path": str(dockerfile.relative_to(self.manager.root_dir)), "content": content})


class ImageBuildCollectionHandler(ImageBuildBaseHandler):
    """List and start authenticated users' Docker image builds."""

    @web.authenticated
    async def get(self) -> None:
        builds = self.manager.build_store.list(self.owner_id)
        self.finish({"builds": [build.to_dict() for build in builds]})

    @web.authenticated
    async def post(self) -> None:
        payload = self.payload()
        dockerfile_path = self.require_string(payload, "dockerfile_path")
        image_reference = self.require_string(payload, "image_reference")
        credential_source = payload.get("credential_source", "admin")
        credential_id = payload.get("credential_id")
        if credential_source not in {"admin", "user"}:
            raise web.HTTPError(400, reason="credential_source must be 'admin' or 'user'.")
        if credential_id is not None and not isinstance(credential_id, str):
            raise web.HTTPError(400, reason="credential_id must be a string.")
        try:
            build = self.manager.start_build(
                self.owner_id, dockerfile_path, image_reference, credential_source, credential_id
            )
        except ValueError as exc:
            raise self.value_error(exc) from exc
        self.set_status(202)
        self.finish(build.to_dict())


class ImageBuildHandler(ImageBuildBaseHandler):
    """Read or delete one completed build owned by the current user."""

    @web.authenticated
    async def get(self, build_id: str) -> None:
        self.finish(self.owned_build(build_id).to_dict())

    @web.authenticated
    async def delete(self, build_id: str) -> None:
        build = self.owned_build(build_id)
        if build.status in {"queued", "running", "pushing"}:
            raise web.HTTPError(409, reason="Active image builds must be stopped before deletion.")
        self.manager.build_store.delete(build_id, self.owner_id)
        self.set_status(204)
        self.finish()


class ImageBuildLogsHandler(ImageBuildBaseHandler):
    """Return chronological, already-redacted logs for an owned build."""

    @web.authenticated
    async def get(self, build_id: str) -> None:
        self.owned_build(build_id)
        self.finish({"logs": [entry.to_dict() for entry in self.manager.build_store.logs(build_id, self.owner_id)]})


class ImageBuildStopHandler(ImageBuildBaseHandler):
    """Request termination of an owned active Docker command."""

    @web.authenticated
    async def post(self, build_id: str) -> None:
        self.owned_build(build_id)
        if not self.manager.stop_build(build_id, self.owner_id):
            raise web.HTTPError(409, reason=f"Image build '{build_id}' is not active.")
        self.finish(self.owned_build(build_id).to_dict())


class ImageBuildPushHandler(ImageBuildBaseHandler):
    """Queue an authenticated push for a successful image build."""

    @web.authenticated
    async def post(self, build_id: str) -> None:
        try:
            build = self.manager.push_build(build_id, self.owner_id)
        except ValueError as exc:
            if self.manager.build_store.get(build_id, self.owner_id) is None:
                raise web.HTTPError(404, reason=str(exc)) from exc
            raise self.value_error(exc) from exc
        self.set_status(202)
        self.finish(build.to_dict())


class RuntimeImageHandler(ImageBuildBaseHandler):
    """Register an owned pushed image in the Runtime Images metadata store."""

    @web.authenticated
    async def post(self, build_id: str) -> None:
        payload = self.payload()
        display_name = self.require_string(payload, "display_name")
        description = payload.get("description")
        if description is not None and not isinstance(description, str):
            raise web.HTTPError(400, reason="description must be a string.")
        try:
            metadata = self.manager.register_runtime_image(build_id, self.owner_id, display_name, description)
        except ValueError as exc:
            if self.manager.build_store.get(build_id, self.owner_id) is None:
                raise web.HTTPError(404, reason=str(exc)) from exc
            raise self.value_error(exc) from exc
        self.set_status(201)
        self.finish(metadata.to_dict(trim=True))


class RegistryCredentialCollectionHandler(ImageBuildBaseHandler):
    """List and create personal registry credential summaries."""

    @web.authenticated
    async def get(self) -> None:
        credentials = (
            self.manager.credential_store.list(self.owner_id)
            if self.manager.registry_settings.credential_master_key
            else []
        )
        if self.manager.registry_settings.has_admin_credential():
            credentials.insert(
                0,
                RegistryCredentialSummary(
                    id="admin",
                    display_name="Administrator default",
                    registry_url=self.manager.registry_settings.admin_registry_url,
                    username=self.manager.registry_settings.admin_username,
                    updated_at=datetime.now(),
                    source="admin",
                ),
            )
        self.finish({"credentials": [credential.to_dict() for credential in credentials]})

    @web.authenticated
    async def post(self) -> None:
        payload = self.payload()
        credential = self._credential_from_payload(payload)
        token = self.require_string(payload, "token")
        try:
            summary = self.manager.credential_store.save(credential, token)
        except ValueError as exc:
            raise self.value_error(exc) from exc
        self.set_status(201)
        self.finish(summary.to_dict())

    def _credential_from_payload(
        self, payload: Dict[str, Any], current: RegistryCredential | None = None
    ) -> RegistryCredential:
        display_name = self.require_string(payload, "display_name")
        registry_url = self.require_string(payload, "registry_url")
        username = self.require_string(payload, "username")
        now = datetime.now()
        return RegistryCredential(
            id=current.id if current else str(uuid4()),
            owner_id=self.owner_id,
            display_name=display_name,
            registry_url=registry_url,
            username=username,
            encrypted_token=current.encrypted_token if current else "pending-encryption",
            created_at=current.created_at if current else now,
            updated_at=now,
        )


class RegistryCredentialHandler(RegistryCredentialCollectionHandler):
    """Update or delete one personal registry credential owned by the user."""

    def current_credential(self, credential_id: str) -> RegistryCredential:
        credential = self.manager.credential_store.get_record(credential_id, self.owner_id)
        if credential is None:
            raise web.HTTPError(404, reason=f"Registry credential '{credential_id}' was not found.")
        return credential

    @web.authenticated
    async def put(self, credential_id: str) -> None:
        current = self.current_credential(credential_id)
        payload = self.payload()
        credential = self._credential_from_payload(payload, current)
        token = payload.get("token")
        if token is None:
            token = self.manager.credential_store.get_token(credential_id, self.owner_id)
        if not isinstance(token, str) or not token:
            raise web.HTTPError(400, reason="token must be a non-empty string.")
        try:
            summary = self.manager.credential_store.save(credential, token)
        except ValueError as exc:
            raise self.value_error(exc) from exc
        self.finish(summary.to_dict())

    @web.authenticated
    async def delete(self, credential_id: str) -> None:
        self.current_credential(credential_id)
        self.manager.credential_store.delete(credential_id, self.owner_id)
        self.set_status(204)
        self.finish()
