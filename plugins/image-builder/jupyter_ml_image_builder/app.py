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
"""Jupyter Server extension for Dockerfile image builds."""

from jupyter_server.extension.application import ExtensionApp

from jupyter_ml_image_builder._version import __version__
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


class ImageBuilderApp(ExtensionApp):
    """Extension application that owns Dockerfile image build services and routes."""

    name = "jupyter_ml_image_builder"
    version = __version__
    description = "Jupyter ML Dockerfile Image Builder"

    classes = [RegistrySettings]

    def initialize_handlers(self):
        build_id_regex = r"(?P<build_id>[\w\.\-]+)"
        credential_id_regex = r"(?P<credential_id>[\w\.\-]+)"

        self.handlers.extend([
            (r"/jupyter-ml/images/dockerfiles", DockerfileHandler),
            (r"/jupyter-ml/images/builds", ImageBuildCollectionHandler),
            (r"/jupyter-ml/images/builds/%s/logs" % build_id_regex, ImageBuildLogsHandler),
            (r"/jupyter-ml/images/builds/%s/stop" % build_id_regex, ImageBuildStopHandler),
            (r"/jupyter-ml/images/builds/%s/push" % build_id_regex, ImageBuildPushHandler),
            (r"/jupyter-ml/images/builds/%s/runtime-image" % build_id_regex, RuntimeImageHandler),
            (r"/jupyter-ml/images/builds/%s" % build_id_regex, ImageBuildHandler),
            (r"/jupyter-ml/images/credentials", RegistryCredentialCollectionHandler),
            (r"/jupyter-ml/images/credentials/%s" % credential_id_regex, RegistryCredentialHandler),
        ])

    def initialize_settings(self):
        self.log.debug("Initializing Jupyter ML image builder settings.")
        manager = ImageBuildManager(
            root_dir=self.settings["server_root_dir"], registry_settings=RegistrySettings(parent=self)
        )
        self.settings["jupyter_ml_image_build_manager"] = manager

    async def stop_extension(self):
        manager = self.settings.get("jupyter_ml_image_build_manager")
        if manager is not None:
            manager.stop()
