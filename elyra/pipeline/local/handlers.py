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
"""REST handlers for persistent local pipeline schedules."""

from datetime import datetime
from typing import Any
from typing import Dict
from typing import List
from uuid import uuid4

from jupyter_server.base.handlers import APIHandler
from tornado import web

from elyra.pipeline.local.models import CronExpression
from elyra.pipeline.local.models import LocalSchedule
from elyra.pipeline.local.models import LocalScheduledRun
from elyra.pipeline.local.scheduler import LocalPipelineScheduler
from elyra.pipeline.validation import PipelineValidationManager


class LocalScheduleBaseHandler(APIHandler):
    """Common validation and serialization helpers for local schedule endpoints."""

    @property
    def scheduler(self) -> LocalPipelineScheduler:
        return self.settings["elyra_local_pipeline_scheduler"]

    async def _validate_pipeline(self, pipeline_definition: Dict[str, Any]) -> None:
        response = await PipelineValidationManager.instance().validate(pipeline_definition)
        if response.has_fatal:
            raise web.HTTPError(400, reason="Errors found in pipeline")

    @staticmethod
    def _parse_timestamp(value: str, field_name: str) -> datetime:
        try:
            return datetime.fromisoformat(value)
        except ValueError as exc:
            raise web.HTTPError(400, reason=f"{field_name} must be an ISO-8601 timestamp.") from exc

    def _schedule_from_payload(
        self, payload: Dict[str, Any], current: LocalSchedule | None = None
    ) -> LocalSchedule:
        required_fields = ("display_name", "pipeline_definition", "cron_expression")
        if current is None:
            missing_fields = [field for field in required_fields if field not in payload]
            if missing_fields:
                raise web.HTTPError(400, reason=f"Missing required fields: {', '.join(missing_fields)}.")

        display_name = payload.get("display_name", current.display_name if current else None)
        pipeline_definition = payload.get("pipeline_definition", current.pipeline_definition if current else None)
        cron_expression = payload.get("cron_expression", current.cron_expression if current else None)
        enabled = payload.get("enabled", current.enabled if current else True)
        if not isinstance(display_name, str) or not display_name.strip():
            raise web.HTTPError(400, reason="display_name must be a non-empty string.")
        if not isinstance(pipeline_definition, dict):
            raise web.HTTPError(400, reason="pipeline_definition must be an object.")
        if not isinstance(enabled, bool):
            raise web.HTTPError(400, reason="enabled must be a boolean.")
        try:
            CronExpression(cron_expression)
        except (TypeError, ValueError) as exc:
            raise web.HTTPError(400, reason=str(exc)) from exc

        now = datetime.now()
        return LocalSchedule(
            id=current.id if current else str(uuid4()),
            display_name=display_name.strip(),
            pipeline_definition=pipeline_definition,
            cron_expression=cron_expression,
            enabled=enabled,
            created_at=current.created_at if current else now,
            updated_at=now,
            next_run_at=current.next_run_at if current else None,
        )


class LocalScheduleCollectionHandler(LocalScheduleBaseHandler):
    """List and create local pipeline schedules."""

    @web.authenticated
    async def get(self) -> None:
        self.finish({"schedules": [schedule.to_dict() for schedule in self.scheduler.schedule_store.list()]})

    @web.authenticated
    async def post(self) -> None:
        payload = self.get_json_body()
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="Request body must be a JSON object.")
        schedule = self._schedule_from_payload(payload)
        await self._validate_pipeline(schedule.pipeline_definition)
        schedule = self.scheduler.save_schedule(schedule)
        self.set_status(201)
        self.finish(schedule.to_dict())


class LocalScheduleHandler(LocalScheduleBaseHandler):
    """Read, update, and delete one local pipeline schedule."""

    def _get_schedule(self, schedule_id: str) -> LocalSchedule:
        schedule = self.scheduler.schedule_store.get(schedule_id)
        if schedule is None:
            raise web.HTTPError(404, reason=f"Local schedule '{schedule_id}' was not found.")
        return schedule

    @web.authenticated
    async def get(self, schedule_id: str) -> None:
        self.finish(self._get_schedule(schedule_id).to_dict())

    @web.authenticated
    async def put(self, schedule_id: str) -> None:
        payload = self.get_json_body()
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="Request body must be a JSON object.")
        current = self._get_schedule(schedule_id)
        schedule = self._schedule_from_payload(payload, current)
        await self._validate_pipeline(schedule.pipeline_definition)
        self.finish(self.scheduler.save_schedule(schedule).to_dict())

    @web.authenticated
    async def delete(self, schedule_id: str) -> None:
        self._get_schedule(schedule_id)
        self.scheduler.delete_schedule(schedule_id)
        self.set_status(204)
        self.finish()


class LocalScheduleRunsHandler(LocalScheduleBaseHandler):
    """Query the persisted runs for one local schedule."""

    @web.authenticated
    async def get(self, schedule_id: str) -> None:
        if self.scheduler.schedule_store.get(schedule_id) is None:
            raise web.HTTPError(404, reason=f"Local schedule '{schedule_id}' was not found.")
        runs = self._filter_runs(self.scheduler.run_store.list(schedule_id))
        self.finish({"runs": [run.to_dict() for run in runs]})

    def _filter_runs(self, runs: List[LocalScheduledRun]) -> List[LocalScheduledRun]:
        status = self.get_query_argument("status", default=None)
        if status and status not in LocalScheduledRun.VALID_STATUSES:
            raise web.HTTPError(400, reason=f"Unsupported local scheduled run status '{status}'.")
        started_after = self.get_query_argument("started_after", default=None)
        started_before = self.get_query_argument("started_before", default=None)
        after = self._parse_timestamp(started_after, "started_after") if started_after else None
        before = self._parse_timestamp(started_before, "started_before") if started_before else None
        if after and before and after > before:
            raise web.HTTPError(400, reason="started_after must be earlier than started_before.")

        return [
            run
            for run in runs
            if (not status or run.status == status)
            and (not after or (run.started_at and run.started_at >= after))
            and (not before or (run.started_at and run.started_at <= before))
        ]


class LocalRunLogsHandler(LocalScheduleBaseHandler):
    """Return structured logs for one local scheduled run."""

    @web.authenticated
    async def get(self, run_id: str) -> None:
        if self.scheduler.run_store.get(run_id) is None:
            raise web.HTTPError(404, reason=f"Local scheduled run '{run_id}' was not found.")
        self.finish({"logs": [entry.to_dict() for entry in self.scheduler.run_store.logs(run_id)]})
