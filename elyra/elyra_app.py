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
import os

from jupyter_server.extension.application import ExtensionApp
from jupyter_server.extension.application import ExtensionAppJinjaMixin

from elyra._version import __version__
from elyra.api.handlers import YamlSpecHandler
from elyra.contents.handlers import ContentHandler
from elyra.images.config import RegistrySettings
from elyra.images.handlers import DockerfileHandler
from elyra.images.handlers import ImageBuildCollectionHandler
from elyra.images.handlers import ImageBuildHandler
from elyra.images.handlers import ImageBuildLogsHandler
from elyra.images.handlers import ImageBuildPushHandler
from elyra.images.handlers import ImageBuildStopHandler
from elyra.images.handlers import RegistryCredentialCollectionHandler
from elyra.images.handlers import RegistryCredentialHandler
from elyra.images.handlers import RuntimeImageHandler
from elyra.images.manager import ImageBuildManager
from elyra.metadata.handlers import MetadataHandler
from elyra.metadata.handlers import MetadataResourceHandler
from elyra.metadata.handlers import SchemaHandler
from elyra.metadata.handlers import SchemaResourceHandler
from elyra.metadata.handlers import SchemaspaceHandler
from elyra.metadata.handlers import SchemaspaceResourceHandler
from elyra.metadata.manager import MetadataManager
from elyra.metadata.schema import SchemaManager
from elyra.metadata.storage import FileMetadataCache
from elyra.pipeline.catalog_connector import ComponentCatalogConnector
from elyra.pipeline.component_catalog import ComponentCache
from elyra.pipeline.handlers import ComponentCacheCatalogHandler
from elyra.pipeline.handlers import ComponentCacheHandler
from elyra.pipeline.handlers import PipelineComponentHandler
from elyra.pipeline.handlers import PipelineComponentPropertiesHandler
from elyra.pipeline.handlers import PipelineExportHandler
from elyra.pipeline.handlers import PipelineParametersHandler
from elyra.pipeline.handlers import PipelinePropertiesHandler
from elyra.pipeline.handlers import PipelineRuntimeTypesHandler
from elyra.pipeline.handlers import PipelineSchedulerHandler
from elyra.pipeline.handlers import PipelineValidationHandler
from elyra.pipeline.local.handlers import LocalRunLogsHandler
from elyra.pipeline.local.handlers import LocalRunHandler
from elyra.pipeline.local.handlers import LocalRunResultsHandler
from elyra.pipeline.local.handlers import LocalRunRetryHandler
from elyra.pipeline.local.handlers import LocalRunStopHandler
from elyra.pipeline.local.handlers import LocalScheduleCollectionHandler
from elyra.pipeline.local.handlers import LocalScheduleHandler
from elyra.pipeline.local.handlers import LocalScheduleRunHandler
from elyra.pipeline.local.handlers import LocalScheduleRunsHandler
from elyra.pipeline.local.scheduler import LocalPipelineScheduler
from elyra.pipeline.processor import PipelineProcessor
from elyra.pipeline.processor import PipelineProcessorManager
from elyra.pipeline.registry import PipelineProcessorRegistry
from elyra.pipeline.validation import PipelineValidationManager

DEFAULT_STATIC_FILES_PATH = os.path.join(os.path.dirname(__file__), "static")
DEFAULT_TEMPLATE_FILES_PATH = os.path.join(os.path.dirname(__file__), "templates")


class ElyraApp(ExtensionAppJinjaMixin, ExtensionApp):
    # The name of the extension.
    name = "elyra"
    version = __version__
    description = "Elyra Server"
    extension_url = "/lab"
    load_other_extensions = True

    classes = [
        FileMetadataCache,
        MetadataManager,
        PipelineProcessorRegistry,
        PipelineProcessor,
        ComponentCatalogConnector,
        ComponentCache,
        RegistrySettings,
    ]

    # Local path to static files directory.
    static_paths = [
        os.path.join(DEFAULT_STATIC_FILES_PATH, "icons"),
    ]

    # Local path to templates directory.
    # template_paths = [
    #     DEFAULT_TEMPLATE_FILES_PATH
    # ]

    # Define ElyraApp configurables here..

    def initialize_handlers(self):
        schemaspace_regex = r"(?P<schemaspace>[\w\.\-]+)"
        resource_regex = r"(?P<resource>[\w\.\-]+)"
        path_regex = r"(?P<path>(?:(?:/[^/]+)+|/?))"  # same as jupyter server and will include a leading slash
        processor_regex = r"(?P<runtime_type>[\w]+)"
        component_regex = r"(?P<component_id>[\w\.\-:%]+)"
        catalog_regex = r"(?P<catalog>[\w\.\-:]+)"
        schedule_id_regex = r"(?P<schedule_id>[\w\.\-]+)"
        run_id_regex = r"(?P<run_id>[\w\.\-]+)"
        image_build_id_regex = r"(?P<build_id>[\w\.\-]+)"
        credential_id_regex = r"(?P<credential_id>[\w\.\-]+)"

        self.handlers.extend(
            [
                # API
                (f"/{self.name}/{YamlSpecHandler.get_resource_metadata()[0]}", YamlSpecHandler),
                # Content
                (f"/{self.name}/contents/properties{path_regex}", ContentHandler),
                # Metadata
                (f"/{self.name}/metadata/{schemaspace_regex}", MetadataHandler),
                (f"/{self.name}/metadata/{schemaspace_regex}/{resource_regex}", MetadataResourceHandler),
                (f"/{self.name}/schema/{schemaspace_regex}", SchemaHandler),
                (f"/{self.name}/schema/{schemaspace_regex}/{resource_regex}", SchemaResourceHandler),
                (f"/{self.name}/schemaspace", SchemaspaceHandler),
                (f"/{self.name}/schemaspace/{schemaspace_regex}", SchemaspaceResourceHandler),
                # Dockerfile Image Builder
                (f"/{self.name}/images/dockerfiles", DockerfileHandler),
                (f"/{self.name}/images/builds", ImageBuildCollectionHandler),
                (f"/{self.name}/images/builds/{image_build_id_regex}/logs", ImageBuildLogsHandler),
                (f"/{self.name}/images/builds/{image_build_id_regex}/stop", ImageBuildStopHandler),
                (f"/{self.name}/images/builds/{image_build_id_regex}/push", ImageBuildPushHandler),
                (f"/{self.name}/images/builds/{image_build_id_regex}/runtime-image", RuntimeImageHandler),
                (f"/{self.name}/images/builds/{image_build_id_regex}", ImageBuildHandler),
                (f"/{self.name}/images/credentials", RegistryCredentialCollectionHandler),
                (f"/{self.name}/images/credentials/{credential_id_regex}", RegistryCredentialHandler),
                # Pipeline
                (f"/{self.name}/pipeline/components/cache", ComponentCacheHandler),
                (f"/{self.name}/pipeline/components/cache/{catalog_regex}", ComponentCacheCatalogHandler),
                (f"/{self.name}/pipeline/components/{processor_regex}", PipelineComponentHandler),
                (
                    f"/{self.name}/pipeline/components/{processor_regex}/{component_regex}",
                    PipelineComponentPropertiesHandler,
                ),
                (
                    f"/{self.name}/pipeline/components/{processor_regex}/{component_regex}/properties",
                    PipelineComponentPropertiesHandler,
                ),
                (f"/{self.name}/pipeline/export", PipelineExportHandler),
                (f"/{self.name}/pipeline/{processor_regex}/properties", PipelinePropertiesHandler),
                (f"/{self.name}/pipeline/{processor_regex}/parameters", PipelineParametersHandler),
                (f"/{self.name}/pipeline/runtimes/types", PipelineRuntimeTypesHandler),
                (f"/{self.name}/pipeline/schedule", PipelineSchedulerHandler),
                (f"/{self.name}/pipeline/validate", PipelineValidationHandler),
                (f"/{self.name}/pipeline/local/schedules", LocalScheduleCollectionHandler),
                (f"/{self.name}/pipeline/local/schedules/{schedule_id_regex}/runs", LocalScheduleRunsHandler),
                (f"/{self.name}/pipeline/local/schedules/{schedule_id_regex}/run", LocalScheduleRunHandler),
                (f"/{self.name}/pipeline/local/schedules/{schedule_id_regex}", LocalScheduleHandler),
                (f"/{self.name}/pipeline/local/runs/{run_id_regex}/retry", LocalRunRetryHandler),
                (f"/{self.name}/pipeline/local/runs/{run_id_regex}/stop", LocalRunStopHandler),
                (f"/{self.name}/pipeline/local/runs/{run_id_regex}/logs", LocalRunLogsHandler),
                (f"/{self.name}/pipeline/local/runs/{run_id_regex}/results", LocalRunResultsHandler),
                (f"/{self.name}/pipeline/local/runs/{run_id_regex}", LocalRunHandler),
            ]
        )

    def initialize_settings(self):
        self.log.debug("Initializing Elyra server settings.")
        # Instantiate singletons with appropriate parent to enable configurability, and convey
        # root_dir to PipelineProcessorManager.
        PipelineProcessorRegistry.instance(root_dir=self.settings["server_root_dir"], parent=self)
        PipelineProcessorManager.instance(root_dir=self.settings["server_root_dir"], parent=self)
        PipelineValidationManager.instance(root_dir=self.settings["server_root_dir"], parent=self)
        FileMetadataCache.instance(parent=self)
        ComponentCache.instance(parent=self).load()
        SchemaManager.instance(parent=self)
        self.local_pipeline_scheduler = LocalPipelineScheduler(root_dir=self.settings["server_root_dir"])
        self.settings["elyra_local_pipeline_scheduler"] = self.local_pipeline_scheduler
        self.local_pipeline_scheduler.start()
        self.image_build_manager = ImageBuildManager(
            root_dir=self.settings["server_root_dir"], registry_settings=RegistrySettings(parent=self)
        )
        self.settings["elyra_image_build_manager"] = self.image_build_manager

    def initialize_templates(self):
        pass

    async def stop_extension(self):
        if hasattr(self, "local_pipeline_scheduler"):
            self.local_pipeline_scheduler.stop()
        if hasattr(self, "image_build_manager"):
            self.image_build_manager.stop()
        PipelineProcessorRegistry.clear_instance()
        PipelineProcessorManager.clear_instance()
        PipelineValidationManager.clear_instance()

        if FileMetadataCache.initialized():
            file_metadata_cache = FileMetadataCache.instance(parent=self)
            if hasattr(file_metadata_cache, "observer") and file_metadata_cache.observer.is_alive():
                file_metadata_cache.observer.stop()  # terminate FileMetadataCache watchdog
            FileMetadataCache.clear_instance()

        if ComponentCache.initialized():
            component_cache = ComponentCache.instance(parent=self)
            component_cache.cache_manager.stop()  # terminate CacheUpdateManager
            if hasattr(component_cache, "observer") and component_cache.observer.is_alive():
                component_cache.observer.stop()  # terminate ComponentCache watchdog
            ComponentCache.clear_instance()

        SchemaManager.clear_instance()


launch_instance = ElyraApp.launch_instance
