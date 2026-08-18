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

from jupyter_server.extension.application import ExtensionApp

from jupyter_ml_scheduling._version import __version__
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

        return [
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
        ]

    def initialize_settings(self):
        self.log.debug("Initializing Jupyter ML local scheduling settings.")
        scheduler = LocalPipelineScheduler(root_dir=self.settings["server_root_dir"])
        self.settings["jupyter_ml_scheduling_scheduler"] = scheduler
        scheduler.start()

    async def stop_extension(self):
        scheduler = self.settings.get("jupyter_ml_scheduling_scheduler")
        if scheduler is not None:
            scheduler.stop()
