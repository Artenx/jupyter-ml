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

from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from datetime import timedelta
from pathlib import Path
import threading
from typing import Callable
from typing import Optional
from uuid import uuid4

from elyra.pipeline.local.local_processor import LocalPipelineProcessor
from elyra.pipeline.local.local_processor import LocalPipelineStoppedError
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
        self._execute_schedule = execute_schedule
        self._active_schedule_ids: set[str] = set()
        self._cancel_events: dict[str, threading.Event] = {}
        self._futures: dict[str, Future] = {}
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
            if run.status in {"queued", "running"}:
                run.status = "failed"
                run.finished_at = now
                run.error_summary = "Jupyter Server stopped before the local pipeline completed."
                self.run_store.save(run, now=now)
                schedule = self.schedule_store.get(run.schedule_id, owner_id=run.owner_id)
                if schedule and run.attempt_number < schedule.retry_policy.max_attempts:
                    self._queue_retry(run, schedule, now)

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
        self._run_due_retries(current_time)

    def run_now(self, schedule_id: str, owner_id: str = "default", now: Optional[datetime] = None) -> LocalScheduledRun:
        """Submit a user-requested run for a managed local task."""
        schedule = self.schedule_store.get(schedule_id, owner_id=owner_id)
        if schedule is None:
            raise ValueError(f"Local schedule '{schedule_id}' was not found.")
        return self._submit_run(schedule, "manual", now or datetime.now())

    def retry_run(self, run_id: str, owner_id: str = "default", now: Optional[datetime] = None) -> LocalScheduledRun:
        """Submit a manual retry that retains the previous run as its parent."""
        run = self.run_store.get(run_id, owner_id=owner_id)
        if run is None:
            raise ValueError(f"Local run '{run_id}' was not found.")
        schedule = self.schedule_store.get(run.schedule_id, owner_id=owner_id)
        if schedule is None:
            raise ValueError(f"Local schedule '{run.schedule_id}' was not found.")
        return self._submit_run(schedule, "retry", now or datetime.now(), parent_run=run)

    def stop_run(self, run_id: str, owner_id: str = "default") -> bool:
        """Request cooperative cancellation for a queued or running local pipeline."""
        run = self.run_store.get(run_id, owner_id=owner_id)
        if run is None or run.status not in {"queued", "running"}:
            return False
        cancel_event = self._cancel_events.get(run_id)
        if cancel_event:
            cancel_event.set()
        future = self._futures.get(run_id)
        if future and future.cancel():
            run.status = "stopped"
            run.finished_at = datetime.now()
            self.run_store.save(run)
            with self._lock:
                self._active_schedule_ids.discard(run.schedule_id)
        return True

    def _run(self) -> None:
        while not self._stopped.is_set():
            self.run_due()
            self._stopped.wait(timeout=1)

    def _trigger(self, schedule: LocalSchedule, now: datetime) -> None:
        # A handler can disable or remove a schedule after the polling loop loads it.
        schedule = self.schedule_store.get(schedule.id, owner_id=schedule.owner_id)
        if schedule is None or not schedule.enabled:
            return
        schedule.next_run_at = CronExpression(schedule.cron_expression).next_after(now)
        schedule.updated_at = now
        self.schedule_store.save(schedule)

        self._submit_run(schedule, "scheduled", now)

    def _run_due_retries(self, now: datetime) -> None:
        for run in self.run_store.list():
            if run.status != "retrying" or run.next_retry_at is None or run.next_retry_at > now:
                continue
            schedule = self.schedule_store.get(run.schedule_id, owner_id=run.owner_id)
            if schedule is None:
                continue
            run.next_retry_at = None
            self.run_store.save(run, now=now)
            self._submit_run(schedule, "retry", now, parent_run=run)

    def _submit_run(
        self,
        schedule: LocalSchedule,
        trigger_type: str,
        now: datetime,
        parent_run: Optional[LocalScheduledRun] = None,
    ) -> LocalScheduledRun:
        with self._lock:
            if schedule.id in self._active_schedule_ids:
                skipped = LocalScheduledRun(
                    id=str(uuid4()), schedule_id=schedule.id, status="skipped", scheduled_at=now,
                    finished_at=now, owner_id=schedule.owner_id, trigger_type=trigger_type,
                    error_summary="Skipped because an earlier run is still active.",
                )
                self.run_store.save(skipped, now=now)
                return skipped
            self._active_schedule_ids.add(schedule.id)

        run_id = str(uuid4())
        run = LocalScheduledRun(
            id=run_id, schedule_id=schedule.id, status="queued", scheduled_at=now,
            owner_id=schedule.owner_id, trigger_type=trigger_type,
            attempt_number=(parent_run.attempt_number + 1) if parent_run else 1,
            parent_run_id=parent_run.id if parent_run else None,
            log_path=str(self.run_store.logs_dir / f"{run_id}.jsonl"),
        )
        self.run_store.save(run, now=now)
        self._cancel_events[run.id] = threading.Event()
        self._futures[run.id] = self._executor.submit(self._execute_run, schedule, run)
        return run

    def _execute_run(self, schedule: LocalSchedule, run: LocalScheduledRun) -> None:
        def observer(level: str, message: str, operation_name: Optional[str] = None) -> None:
            self.run_store.append_log(run, RunLogEntry(datetime.now(), level, message, operation_name))

        cancel_event = self._cancel_events[run.id]
        run.status = "running"
        run.started_at = datetime.now()
        self.run_store.save(run)
        observer("INFO", "Local scheduled pipeline started.")
        try:
            if self._execute_schedule:
                self._execute_schedule(schedule, observer)
            else:
                self._default_execute_schedule(schedule, run, observer, cancel_event)
        except LocalPipelineStoppedError:
            observer("INFO", "Local scheduled pipeline stopped.")
            run.status = "stopped"
        except Exception as exc:
            observer("ERROR", str(exc))
            run.status = "failed"
            run.error_summary = str(exc)
        else:
            if cancel_event.is_set():
                observer("INFO", "Local scheduled pipeline stopped.")
                run.status = "stopped"
            else:
                observer("INFO", "Local scheduled pipeline completed.")
                run.status = "succeeded"
        finally:
            run.finished_at = datetime.now()
            with self._lock:
                self._active_schedule_ids.discard(schedule.id)
            if run.status == "failed" and run.attempt_number < schedule.retry_policy.max_attempts:
                self._queue_retry(run, schedule, run.finished_at)
            self.run_store.save(run)
            self._cancel_events.pop(run.id, None)
            self._futures.pop(run.id, None)

    def _queue_retry(self, run: LocalScheduledRun, schedule: LocalSchedule, now: datetime) -> None:
        delay = schedule.retry_policy.initial_delay_seconds * (
            schedule.retry_policy.backoff_multiplier ** (run.attempt_number - 1)
        )
        run.status = "retrying"
        run.next_retry_at = now + timedelta(seconds=delay)

    def _default_execute_schedule(
        self, schedule: LocalSchedule, run: LocalScheduledRun, observer: RunObserver, cancel_event: threading.Event
    ) -> None:
        pipeline = PipelineParser(root_dir=str(self.root_dir) if self.root_dir else None).parse(schedule.pipeline_definition)
        processor = PipelineProcessorManager.instance().get_processor_for_runtime("local")
        if not isinstance(processor, LocalPipelineProcessor):
            raise RuntimeError("The local pipeline processor is unavailable.")
        processor.process(
            pipeline,
            run_observer=observer,
            cancel_event=cancel_event,
            remote_kernel_observer=lambda kernel_id: self._save_remote_kernel_id(run, kernel_id),
        )

    def _save_remote_kernel_id(self, run: LocalScheduledRun, kernel_id: str) -> None:
        run.remote_kernel_id = kernel_id
        self.run_store.save(run)
