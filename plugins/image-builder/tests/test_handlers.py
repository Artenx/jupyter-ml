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
import json
from datetime import datetime
from pathlib import Path
import tempfile

from cryptography.fernet import Fernet
from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from jupyter_ml_image_builder.config import RegistrySettings
from jupyter_ml_image_builder.handlers import DockerfileHandler
from jupyter_ml_image_builder.handlers import ImageBuildCollectionHandler
from jupyter_ml_image_builder.handlers import ImageBuildHandler
from jupyter_ml_image_builder.handlers import ImageBuildLogsHandler
from jupyter_ml_image_builder.handlers import ImageBuildPushHandler
from jupyter_ml_image_builder.handlers import ImageBuildStopHandler
from jupyter_ml_image_builder.handlers import RegistryCredentialCollectionHandler
from jupyter_ml_image_builder.handlers import RegistryCredentialHandler
from jupyter_ml_image_builder.handlers import RuntimeImageHandler
from jupyter_ml_image_builder.manager import ImageBuildManager
from jupyter_ml_image_builder.models import ImageBuild
from jupyter_ml_image_builder.models import ImageBuildLogEntry
from jupyter_ml_image_builder.storage import ImageBuildStore
from jupyter_ml_image_builder.storage import RegistryCredentialStore
from elyra.metadata.error import MetadataNotFoundError


class AuthenticatedHandlerMixin:
    def get_current_user(self):
        return self.request.headers.get("X-Test-User", "alice")

    def check_xsrf_cookie(self):
        pass


class AuthenticatedDockerfileHandler(AuthenticatedHandlerMixin, DockerfileHandler):
    pass


class AuthenticatedImageBuildCollectionHandler(AuthenticatedHandlerMixin, ImageBuildCollectionHandler):
    pass


class AuthenticatedImageBuildHandler(AuthenticatedHandlerMixin, ImageBuildHandler):
    pass


class AuthenticatedImageBuildLogsHandler(AuthenticatedHandlerMixin, ImageBuildLogsHandler):
    pass


class AuthenticatedImageBuildStopHandler(AuthenticatedHandlerMixin, ImageBuildStopHandler):
    pass


class AuthenticatedImageBuildPushHandler(AuthenticatedHandlerMixin, ImageBuildPushHandler):
    pass


class AuthenticatedRuntimeImageHandler(AuthenticatedHandlerMixin, RuntimeImageHandler):
    pass


class AuthenticatedCredentialCollectionHandler(AuthenticatedHandlerMixin, RegistryCredentialCollectionHandler):
    pass


class AuthenticatedCredentialHandler(AuthenticatedHandlerMixin, RegistryCredentialHandler):
    pass


class RuntimeImageManagerStub:
    def get(self, name):
        raise MetadataNotFoundError("runtime-images", name)

    def create(self, _name, metadata):
        return metadata

    def update(self, _name, metadata):
        return metadata


class TestImageBuildHandlers(AsyncHTTPTestCase):
    def setUp(self):
        self._storage = tempfile.TemporaryDirectory()
        root = Path(self._storage.name) / "workspace"
        root.mkdir()
        (root / "Dockerfile").write_text("FROM python:3.12", encoding="utf-8")
        settings = RegistrySettings()
        settings.admin_registry_url = "registry.example.com"
        settings.admin_username = "admin"
        settings.admin_token = "admin-token"
        settings.credential_master_key = Fernet.generate_key().decode("utf-8")
        settings.allowed_build_users = ["alice"]
        self.manager = ImageBuildManager(
            str(root),
            build_store=ImageBuildStore(Path(self._storage.name) / "builds"),
            credential_store=RegistryCredentialStore(
                settings.credential_master_key, Path(self._storage.name) / "credentials"
            ),
            registry_settings=settings,
            runtime_image_manager=RuntimeImageManagerStub(),
        )
        self.manager._submit = lambda *_: None
        super().setUp()

    def tearDown(self):
        super().tearDown()
        self.manager.stop()
        self._storage.cleanup()

    def get_app(self):
        return Application(
            [
                (r"/dockerfiles", AuthenticatedDockerfileHandler),
                (r"/builds", AuthenticatedImageBuildCollectionHandler),
                (r"/builds/(?P<build_id>[\w.\-]+)/logs", AuthenticatedImageBuildLogsHandler),
                (r"/builds/(?P<build_id>[\w.\-]+)/stop", AuthenticatedImageBuildStopHandler),
                (r"/builds/(?P<build_id>[\w.\-]+)/push", AuthenticatedImageBuildPushHandler),
                (r"/builds/(?P<build_id>[\w.\-]+)/runtime-image", AuthenticatedRuntimeImageHandler),
                (r"/builds/(?P<build_id>[\w.\-]+)", AuthenticatedImageBuildHandler),
                (r"/credentials", AuthenticatedCredentialCollectionHandler),
                (r"/credentials/(?P<credential_id>[\w.\-]+)", AuthenticatedCredentialHandler),
            ],
            jupyter_ml_image_build_manager=self.manager,
            cookie_secret="test-cookie-secret",
            xsrf_cookies=False,
        )

    def fetch_as(self, path, user="alice", **kwargs):
        headers = kwargs.pop("headers", {})
        headers["X-Test-User"] = user
        if kwargs.get("method") in {"POST", "PUT", "PATCH"} and "body" not in kwargs:
            kwargs["body"] = ""
        return self.fetch(path, headers=headers, **kwargs)

    @staticmethod
    def payload(**values):
        return json.dumps(values)

    def _save_build(self, build_id="build-1", owner_id="alice", status="succeeded"):
        build = ImageBuild(
            id=build_id,
            owner_id=owner_id,
            dockerfile_path="Dockerfile",
            context_path=".",
            image_reference="registry.example.com/team/image:latest",
            status=status,
            credential_source="admin",
            created_at=datetime.now(),
        )
        self.manager.build_store.save(build)
        return build

    def test_dockerfile_create_read_save_and_path_validation(self):
        response = self.fetch_as(
            "/dockerfiles", method="POST", body=self.payload(path="images/Dockerfile", content="FROM alpine")
        )
        assert response.code == 201
        assert self.fetch_as("/dockerfiles?path=images/Dockerfile").code == 200
        response = self.fetch_as(
            "/dockerfiles", method="PUT", body=self.payload(path="images/Dockerfile", content="FROM python:3.12")
        )
        assert json.loads(response.body)["content"] == "FROM python:3.12"
        assert self.fetch_as("/dockerfiles", method="POST", body=self.payload(path="../Dockerfile")).code == 400

    def test_build_requests_validate_and_isolate_builds_and_logs(self):
        assert self.fetch_as("/builds", method="POST", body=self.payload()).code == 400
        assert (
            self.fetch_as(
                "/builds",
                user="bob",
                method="POST",
                body=self.payload(
                    dockerfile_path="Dockerfile", image_reference="registry.example.com/team/image:latest"
                ),
            ).code
            == 403
        )
        response = self.fetch_as(
            "/builds",
            method="POST",
            body=self.payload(dockerfile_path="Dockerfile", image_reference="registry.example.com/team/image:latest"),
        )
        build = json.loads(response.body)
        assert response.code == 202
        self.manager.build_store.append_log(
            build["id"], "alice", ImageBuildLogEntry(datetime.now(), "INFO", "Token [REDACTED]")
        )
        assert self.fetch_as(f"/builds/{build['id']}", user="bob").code == 404
        response = self.fetch_as(f"/builds/{build['id']}/logs")
        assert "[REDACTED]" in json.loads(response.body)["logs"][0]["message"]
        assert self.fetch_as(f"/builds/{build['id']}/stop", method="POST").code == 200
        assert self.fetch_as(f"/builds/{build['id']}", method="DELETE").code == 204

    def test_credentials_return_only_safe_summaries_and_are_user_isolated(self):
        response = self.fetch_as("/credentials")
        assert json.loads(response.body)["credentials"][0]["source"] == "admin"
        response = self.fetch_as(
            "/credentials",
            method="POST",
            body=self.payload(
                display_name="Private registry",
                registry_url="private.example.com",
                username="alice",
                token="private-token",
            ),
        )
        created = json.loads(response.body)
        assert response.code == 201
        assert "token" not in created
        assert "private-token" not in response.body.decode("utf-8")
        assert len(json.loads(self.fetch_as("/credentials", user="bob").body)["credentials"]) == 1
        response = self.fetch_as(
            f"/credentials/{created['id']}",
            method="PUT",
            body=self.payload(display_name="Updated registry", registry_url="private.example.com", username="alice"),
        )
        assert json.loads(response.body)["display_name"] == "Updated registry"
        assert self.fetch_as(f"/credentials/{created['id']}", user="bob", method="DELETE").code == 404
        assert self.fetch_as(f"/credentials/{created['id']}", method="DELETE").code == 204

    def test_push_and_runtime_image_require_owned_eligible_builds(self):
        succeeded = self._save_build()
        assert self.fetch_as(f"/builds/{succeeded.id}/push", user="bob", method="POST").code == 404
        assert self.fetch_as(f"/builds/{succeeded.id}/push", method="POST").code == 202
        queued = self._save_build("queued", status="queued")
        assert (
            self.fetch_as(
                f"/builds/{queued.id}/runtime-image", method="POST", body=self.payload(display_name="Queued image")
            ).code
            == 400
        )
        pushed = self._save_build("pushed", status="pushed")
        response = self.fetch_as(
            f"/builds/{pushed.id}/runtime-image",
            method="POST",
            body=self.payload(display_name="Published image", description="Ready to use"),
        )
        assert response.code == 201
        assert json.loads(response.body)["metadata"]["image_name"] == pushed.image_reference
