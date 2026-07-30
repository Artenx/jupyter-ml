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
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
import threading
from typing import Callable
from typing import Optional
from uuid import uuid4

from elyra.pipeline.local.local_processor import LocalPipelineProcessor
from elyra.pipeline.local.models import CronExpression
from elyra.pipeline.local.models import LocalSchedule
from elyra.pipeline.local.models import LocalScheduledRun
from elyra.pipeline.local.models import RunLogEntry
from elyra.pipeline.local.run_store import RunStore
from elyra.pipeline.local.schedule_store import ScheduleStore
from elyra.pipeline.parser import PipelineParser
from elyra.pipeline.processor import PipelineProcessorManager


RunObserver = Callable[[str, str, Optional[str]], None]
ScheduleExecutor = Callable[[LocalSchedule, RunObserver], None]


class LocalPipelineScheduler:
    """Schedules local pipelines and records their execution lifecycle."""

    def __init__(
        self,
        root_dir: Optional[str] = None,
        schedule_store: Optional[ScheduleStore] = None,
        run_store: Optional[RunStore] = None,
        execute_schedule: Optional[ScheduleExecutor] = None,
    ):
        self.root_dir = Path(root_dir).expanduser() if root_dir else None
        self.schedule_store = schedule_store or ScheduleStore()
        self.run_store = run_store or RunStore()
        self._execute_schedule = execute_schedule or self._default_execute_schedule
        self._active_schedule_ids: set[str] = set()
        self._lock = threading.Lock()
        self._stopped = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="elyra-local-pipeline")

    def start(self) -> None:
        """Recover persisted schedules and start the scheduler loop."""
        if self._thread and self._thread.is_alive():
            return
        self._stopped.clear()
        self.recover(datetime.now())
        self._thread = threading.Thread(target=self._run, name="elyra-local-scheduler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Stop future triggers and wait for active local executions."""
        self._stopped.set()
        if self._thread and self._thread.is_alive():
            self._thread.join()
        self._executor.shutdown(wait=True)

    def recover(self, now: datetime) -> None:
        """Finalize interrupted runs and schedule future triggers from ``now``."""
        for run in self.run_store.list():
            if run.status == "running":
                run.status = "failed"
                run.finished_at = now
                run.error_summary = "Jupyter Server stopped before the local pipeline completed."
                self.run_store.save(run, now=now)

        for schedule in self.schedule_store.list():
            if schedule.enabled:
                schedule.next_run_at = CronExpression(schedule.cron_expression).next_after(now)
                schedule.updated_at = now
                self.schedule_store.save(schedule)

    def save_schedule(self, schedule: LocalSchedule, now: Optional[datetime] = None) -> LocalSchedule:
        """Persist a schedule with its next trigger calculated from the current time."""
        current_time = now or datetime.now()
        schedule.updated_at = current_time
        schedule.next_run_at = (
            CronExpression(schedule.cron_expression).next_after(current_time) if schedule.enabled else None
        )
        return self.schedule_store.save(schedule)

    def delete_schedule(self, schedule_id: str) -> bool:
        """Remove a persisted schedule so future scheduler cycles cannot trigger it."""
        return self.schedule_store.delete(schedule_id)

    def run_due(self, now: Optional[datetime] = None) -> None:
        """Submit each enabled schedule whose next trigger has arrived."""
        current_time = now or datetime.now()
        for schedule in self.schedule_store.list():
            if not schedule.enabled:
                continue
            if schedule.next_run_at is None:
                schedule.next_run_at = CronExpression(schedule.cron_expression).next_after(current_time)
                schedule.updated_at = current_time
                self.schedule_store.save(schedule)
                continue
            if schedule.next_run_at <= current_time:
                self._trigger(schedule, current_time)

    def _run(self) -> None:
        while not self._stopped.is_set():
            self.run_due()
            self._stopped.wait(timeout=1)

    def _trigger(self, schedule: LocalSchedule, now: datetime) -> None:
        # A handler can disable or remove a schedule after the polling loop loads it.
        schedule = self.schedule_store.get(schedule.id)
        if schedule is None or not schedule.enabled:
            return
        schedule.next_run_at = CronExpression(schedule.cron_expression).next_after(now)
        schedule.updated_at = now
        self.schedule_store.save(schedule)

        with self._lock:
            if schedule.id in self._active_schedule_ids:
                self.run_store.save(
                    LocalScheduledRun(
                        id=str(uuid4()),
                        schedule_id=schedule.id,
                        status="skipped",
                        scheduled_at=now,
                        finished_at=now,
                        error_summary="Skipped because an earlier run is still active.",
                    ),
                    now=now,
                )
                return
            self._active_schedule_ids.add(schedule.id)

        run_id = str(uuid4())
        run = LocalScheduledRun(
            id=run_id,
            schedule_id=schedule.id,
            status="running",
            scheduled_at=now,
            started_at=now,
            log_path=str(self.run_store.logs_dir / f"{run_id}.jsonl"),
        )
        self.run_store.save(run, now=now)
        self._executor.submit(self._execute_run, schedule, run)

    def _execute_run(self, schedule: LocalSchedule, run: LocalScheduledRun) -> None:
        def observer(level: str, message: str, operation_name: Optional[str] = None) -> None:
            self.run_store.append_log(run, RunLogEntry(datetime.now(), level, message, operation_name))

        observer("INFO", "Local scheduled pipeline started.")
        try:
            self._execute_schedule(schedule, observer)
        except Exception as exc:
            observer("ERROR", str(exc))
            run.status = "failed"
            run.error_summary = str(exc)
        else:
            observer("INFO", "Local scheduled pipeline completed.")
            run.status = "succeeded"
        finally:
            run.finished_at = datetime.now()
            self.run_store.save(run)
            with self._lock:
                self._active_schedule_ids.discard(schedule.id)

    def _default_execute_schedule(self, schedule: LocalSchedule, observer: RunObserver) -> None:
        pipeline = PipelineParser(root_dir=str(self.root_dir) if self.root_dir else None).parse(schedule.pipeline_definition)
        processor = PipelineProcessorManager.instance().get_processor_for_runtime("local")
        if not isinstance(processor, LocalPipelineProcessor):
            raise RuntimeError("The local pipeline processor is unavailable.")
        processor.process(pipeline, run_observer=observer)
