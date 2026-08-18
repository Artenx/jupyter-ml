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
"""Intercept upstream pipeline submissions to record local runs in history."""

import json

from tornado import web

from elyra.pipeline.handlers import PipelineSchedulerHandler
from elyra.pipeline.parser import PipelineParser
from elyra.pipeline.validation import PipelineValidationManager

from jupyter_ml_scheduling.scheduler import LocalPipelineScheduler


class LocalSchedulingSubmitHandler(PipelineSchedulerHandler):
    """Record local pipeline submissions and delegate non-local ones upstream.

    Upstream ``PipelineSchedulerHandler.post`` executes local pipelines
    synchronously and records no history.  This handler is registered in front of
    the upstream route so that local submissions create a persistent run record
    via ``submit_direct`` (returning HTTP 202) while every other runtime falls
    through to the upstream implementation unchanged.
    """

    @property
    def scheduler(self) -> LocalPipelineScheduler:
        return self.settings["jupyter_ml_scheduling_scheduler"]

    @property
    def owner_id(self) -> str:
        """Return a stable identifier for the authenticated Jupyter user."""
        user = self.current_user
        if isinstance(user, dict):
            return str(user.get("name") or user.get("username"))
        return str(getattr(user, "username", user))

    @web.authenticated
    async def post(self, *args, **kwargs):
        pipeline_definition = self.get_json_body()
        response = await PipelineValidationManager.instance().validate(pipeline=pipeline_definition)

        if not response.has_fatal:
            pipeline = PipelineParser(root_dir=self.settings["server_root_dir"]).parse(pipeline_definition)
            if pipeline.runtime == "local":
                run = self.scheduler.submit_direct(
                    pipeline_definition=pipeline_definition,
                    owner_id=self.owner_id,
                    name=pipeline.name,
                )
                self.set_status(202)
                self.set_header("Content-Type", "application/json")
                await self.finish(json.dumps(run.to_dict()))
                return

        await super().post(*args, **kwargs)
