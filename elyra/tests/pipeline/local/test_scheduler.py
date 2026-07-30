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
from datetime import datetime
from threading import Event

from elyra.pipeline.local.models import LocalSchedule
from elyra.pipeline.local.models import LocalScheduledRun
from elyra.pipeline.local.run_store import RunStore
from elyra.pipeline.local.schedule_store import ScheduleStore
from elyra.pipeline.local.scheduler import LocalPipelineScheduler


def _schedule(next_run_at: datetime) -> LocalSchedule:
    return LocalSchedule(
        id="hourly-pipeline",
        display_name="Hourly pipeline",
        pipeline_definition={"doc_type": "pipeline"},
        cron_expression="0 * * * *",
        enabled=True,
        created_at=datetime(2026, 7, 29, 8, 0),
        updated_at=datetime(2026, 7, 29, 8, 0),
        next_run_at=next_run_at,
    )


def test_scheduler_executes_due_schedule_and_records_logs(tmp_path):
    schedule_store = ScheduleStore(tmp_path)
    run_store = RunStore(tmp_path)
    executed = Event()

    def execute(schedule, observer):
        observer("INFO", "Operation started.", "node-1")
        executed.set()

    scheduler = LocalPipelineScheduler(
        schedule_store=schedule_store,
        run_store=run_store,
        execute_schedule=execute,
    )
    schedule_store.save(_schedule(datetime(2026, 7, 29, 9, 0)))

    scheduler.run_due(datetime(2026, 7, 29, 9, 0))

    assert executed.wait(timeout=1)
    scheduler.stop()
    runs = run_store.list()
    assert len(runs) == 1
    assert runs[0].status == "succeeded"
    assert [entry.operation_name for entry in run_store.logs(runs[0].id)] == [None, "node-1", None]


def test_scheduler_skips_overlapping_schedule_trigger(tmp_path):
    schedule_store = ScheduleStore(tmp_path)
    run_store = RunStore(tmp_path)
    scheduler = LocalPipelineScheduler(schedule_store=schedule_store, run_store=run_store)
    schedule = _schedule(datetime(2026, 7, 29, 9, 0))
    schedule_store.save(schedule)

    scheduler._active_schedule_ids.add(schedule.id)
    scheduler.run_due(datetime(2026, 7, 29, 9, 0))
    scheduler.stop()

    runs = run_store.list()
    assert len(runs) == 1
    assert runs[0].status == "skipped"


def test_scheduler_does_not_trigger_removed_schedule(tmp_path):
    schedule_store = ScheduleStore(tmp_path)
    run_store = RunStore(tmp_path)
    scheduler = LocalPipelineScheduler(schedule_store=schedule_store, run_store=run_store)
    schedule = _schedule(datetime(2026, 7, 29, 9, 0))
    schedule_store.save(schedule)
    schedule_store.delete(schedule.id)

    scheduler._trigger(schedule, datetime(2026, 7, 29, 9, 0))
    scheduler.stop()

    assert run_store.list() == []


def test_scheduler_recovery_sets_next_trigger_and_finalizes_interrupted_run(tmp_path):
    schedule_store = ScheduleStore(tmp_path)
    run_store = RunStore(tmp_path)
    scheduler = LocalPipelineScheduler(schedule_store=schedule_store, run_store=run_store)
    now = datetime(2026, 7, 29, 9, 15)
    schedule_store.save(_schedule(datetime(2026, 7, 29, 9, 0)))
    run_store.save(
        LocalScheduledRun(
            id="interrupted",
            schedule_id="hourly-pipeline",
            status="running",
            scheduled_at=datetime(2026, 7, 29, 9, 0),
        ),
        now=now,
    )

    scheduler.recover(now)
    scheduler.stop()

    assert schedule_store.get("hourly-pipeline").next_run_at == datetime(2026, 7, 29, 10, 0)
    assert run_store.get("interrupted").status == "failed"
