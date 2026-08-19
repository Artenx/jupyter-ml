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
"""Jupyter Server extension for local pipeline scheduling."""

import json

from jupyter_server.extension.application import ExtensionApp

from elyra.pipeline.processor import PipelineProcessorManager

from jupyter_ml_scheduling._version import __version__
from jupyter_ml_scheduling.processor import LocalPipelineProcessor
from jupyter_ml_scheduling.handlers import LocalDirectRunsHandler
from jupyter_ml_scheduling.handlers import LocalRunHandler
from jupyter_ml_scheduling.handlers import LocalRunLogsHandler
from jupyter_ml_scheduling.handlers import LocalRunResultsHandler
from jupyter_ml_scheduling.handlers import LocalRunRetryHandler
from jupyter_ml_scheduling.handlers import LocalRunStopHandler
from jupyter_ml_scheduling.handlers import LocalScheduleCollectionHandler
from jupyter_ml_scheduling.handlers import LocalScheduleHandler
from jupyter_ml_scheduling.handlers import LocalScheduleRunHandler
from jupyter_ml_scheduling.handlers import LocalScheduleRunsHandler
from jupyter_ml_scheduling.override import LocalSchedulingSubmitHandler
from jupyter_ml_scheduling.scheduler import LocalPipelineScheduler


class LocalSchedulingApp(ExtensionApp):
    """Extension application that owns the local scheduling scheduler and routes."""

    name = "jupyter_ml_scheduling"
    version = __version__
    description = "Jupyter ML Local Pipeline Scheduling"

    def initialize_handlers(self):
        schedule_id_regex = r"(?P<schedule_id>[\w\.\-]+)"
        run_id_regex = r"(?P<run_id>[\w\.\-]+)"

        self.handlers.extend([
            # Direct run interception must precede the upstream /elyra/pipeline/schedule route.
            (r"/elyra/pipeline/schedule", LocalSchedulingSubmitHandler),
            (r"/jupyter-ml/local/schedules", LocalScheduleCollectionHandler),
            (r"/jupyter-ml/local/schedules/%s/runs" % schedule_id_regex, LocalScheduleRunsHandler),
            (r"/jupyter-ml/local/schedules/%s/run" % schedule_id_regex, LocalScheduleRunHandler),
            (r"/jupyter-ml/local/schedules/%s" % schedule_id_regex, LocalScheduleHandler),
            (r"/jupyter-ml/local/runs", LocalDirectRunsHandler),
            (r"/jupyter-ml/local/runs/%s/retry" % run_id_regex, LocalRunRetryHandler),
            (r"/jupyter-ml/local/runs/%s/stop" % run_id_regex, LocalRunStopHandler),
            (r"/jupyter-ml/local/runs/%s/logs" % run_id_regex, LocalRunLogsHandler),
            (r"/jupyter-ml/local/runs/%s/results" % run_id_regex, LocalRunResultsHandler),
            (r"/jupyter-ml/local/runs/%s" % run_id_regex, LocalRunHandler),
        ])

    def initialize_settings(self):
        self.log.info("Initializing Jupyter ML local scheduling settings.")
        # Replace the registry's local processor with ours so the upstream
        # PipelineSchedulerHandler dispatches local runs through the
        # lifecycle-observing processor instead of elyra's stock one.
        try:
            registry = PipelineProcessorManager.instance()._registry
            self.log.info(f"Before replace: local processor = {type(registry._processors.get('local')).__name__}")
            registry._processors["local"] = LocalPipelineProcessor(
                root_dir=self.settings["server_root_dir"]
            )
            self.log.info(f"After replace: local processor = {type(registry._processors.get('local')).__name__}")
        except Exception as e:
            self.log.error(f"Failed to replace local processor: {e}", exc_info=True)
        scheduler = LocalPipelineScheduler(root_dir=self.settings["server_root_dir"])
        self.settings["jupyter_ml_scheduling_scheduler"] = scheduler
        scheduler.start()

        # Patch elyra's PipelineSchedulerHandler.post so local runtime
        # submissions are recorded in the run history. Elyra registers its
        # /elyra/pipeline/schedule route before our extension loads, so our
        # handler never matches. Instead we wrap the upstream post() to
        # intercept local submissions and delegate the rest unchanged.
        self._patch_scheduler_handler()

        self.log.info("Jupyter ML local scheduling initialized.")

    def _patch_scheduler_handler(self) -> None:
        """Wrap elyra's PipelineSchedulerHandler.post to record local runs."""
        from elyra.pipeline.handlers import PipelineSchedulerHandler
        from elyra.pipeline.parser import PipelineParser
        from elyra.pipeline.validation import PipelineValidationManager

        scheduler = self.settings["jupyter_ml_scheduling_scheduler"]
        original_post = PipelineSchedulerHandler.post

        async def patched_post(self_handler, *args, **kwargs):
            pipeline_definition = self_handler.get_json_body()
            response = await PipelineValidationManager.instance().validate(pipeline=pipeline_definition)
            if not response.has_fatal:
                pipeline = PipelineParser(
                    root_dir=self_handler.settings["server_root_dir"]
                ).parse(pipeline_definition)
                if pipeline.runtime == "local":
                    user = self_handler.current_user
                    if isinstance(user, dict):
                        owner_id = str(user.get("name") or user.get("username"))
                    else:
                        owner_id = str(getattr(user, "username", user))
                    run = scheduler.submit_direct(
                        pipeline_definition=pipeline_definition,
                        owner_id=owner_id,
                        name=pipeline.name,
                    )
                    self_handler.log.info(f"Direct run recorded: id={run.id}")
                    self_handler.set_status(202)
                    self_handler.set_header("Content-Type", "application/json")
                    await self_handler.finish(json.dumps(run.to_dict()))
                    return
            await original_post(self_handler, *args, **kwargs)

        patched_post.__wrapped__ = original_post
        PipelineSchedulerHandler.post = patched_post
        self.log.info("Patched PipelineSchedulerHandler.post to intercept local runs.")

    async def stop_extension(self):
        scheduler = self.settings.get("jupyter_ml_scheduling_scheduler")
        if scheduler is not None:
            scheduler.stop()
