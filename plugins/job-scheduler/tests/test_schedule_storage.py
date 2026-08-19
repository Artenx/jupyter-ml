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
from datetime import timedelta

import pytest

from jupyter_ml_job_scheduler.models import CronExpression
from jupyter_ml_job_scheduler.models import LocalSchedule
from jupyter_ml_job_scheduler.models import LocalScheduledRun
from jupyter_ml_job_scheduler.models import RetryPolicy
from jupyter_ml_job_scheduler.models import RunLogEntry
from jupyter_ml_job_scheduler.models import RunResult
from jupyter_ml_job_scheduler.run_store import RunStore
from jupyter_ml_job_scheduler.schedule_store import ScheduleStore


def _schedule() -> LocalSchedule:
    now = datetime(2026, 7, 29, 10, 0)
    return LocalSchedule(
        id="daily-pipeline",
        display_name="Daily pipeline",
        pipeline_definition={"doc_type": "pipeline"},
        cron_expression="0 2 * * *",
        enabled=True,
        created_at=now,
        updated_at=now,
        next_run_at=datetime(2026, 7, 30, 2, 0),
    )


def _run(run_id: str, scheduled_at: datetime, status: str = "succeeded") -> LocalScheduledRun:
    return LocalScheduledRun(id=run_id, schedule_id="daily-pipeline", status=status, scheduled_at=scheduled_at)


def test_cron_expression_validates_and_finds_next_trigger():
    expression = CronExpression("*/15 9-17 * * 1-5")

    assert expression.matches(datetime(2026, 7, 29, 9, 15))
    assert expression.next_after(datetime(2026, 7, 29, 9, 15)) == datetime(2026, 7, 29, 9, 30)


@pytest.mark.parametrize("expression", ["* * * *", "60 * * * *", "*/0 * * * *", "3-1 * * * *"])
def test_cron_expression_rejects_invalid_values(expression):
    with pytest.raises(ValueError):
        CronExpression(expression)


def test_schedule_round_trip_and_crud(tmp_path):
    store = ScheduleStore(tmp_path)
    schedule = _schedule()

    assert store.save(schedule) == schedule
    assert store.get(schedule.id) == schedule

    schedule.enabled = False
    assert store.save(schedule).enabled is False
    assert store.list() == [schedule]
    assert store.delete(schedule.id)
    assert store.list() == []


def test_run_and_log_round_trip(tmp_path):
    store = RunStore(tmp_path)
    run = _run("run-1", datetime(2026, 7, 29, 2, 0), "running")
    entry = RunLogEntry(datetime(2026, 7, 29, 2, 1), "INFO", "Started", "node-1")

    store.save(run)
    store.append_log(run, entry)

    assert store.get(run.id) == run
    assert store.logs(run.id) == [entry]


def test_run_store_prunes_records_over_count_or_age_and_removes_logs(tmp_path):
    store = RunStore(tmp_path)
    now = datetime(2026, 7, 29, 12, 0)
    recent_runs = [_run(f"run-{index}", now - timedelta(minutes=index)) for index in range(101)]
    expired_run = _run("expired", now - timedelta(days=91))

    for run in [*recent_runs, expired_run]:
        store.append_log(run, RunLogEntry(now, "INFO", "record"))
        store.save(run, now=now)

    retained_ids = {run.id for run in store.list()}
    assert len(retained_ids) == 100
    assert "run-100" not in retained_ids
    assert "expired" not in retained_ids
    assert store.logs("run-100") == []
    assert store.logs("expired") == []


def test_schedule_and_run_models_load_historical_data_with_management_defaults():
    schedule = LocalSchedule.from_dict(
        {
            "id": "legacy-schedule",
            "display_name": "Legacy schedule",
            "pipeline_definition": {"doc_type": "pipeline"},
            "cron_expression": "0 2 * * *",
            "enabled": True,
            "created_at": "2026-07-29T10:00:00",
            "updated_at": "2026-07-29T10:00:00",
        }
    )
    run = LocalScheduledRun.from_dict(
        {
            "id": "legacy-run",
            "schedule_id": "legacy-schedule",
            "status": "succeeded",
            "scheduled_at": "2026-07-29T10:00:00",
        }
    )

    assert schedule.owner_id == "default"
    assert schedule.retry_policy == RetryPolicy()
    assert run.owner_id == "default"
    assert run.trigger_type == "scheduled"
    assert run.attempt_number == 1


@pytest.mark.parametrize(
    "policy",
    [
        {"max_attempts": 0},
        {"initial_delay_seconds": -1},
        {"backoff_multiplier": 0.5},
    ],
)
def test_retry_policy_rejects_invalid_values(policy):
    with pytest.raises(ValueError):
        RetryPolicy(**policy)


def test_schedule_store_filters_and_deletes_only_matching_owner(tmp_path):
    store = ScheduleStore(tmp_path)
    owner_schedule = _schedule()
    owner_schedule.owner_id = "alice"
    other_schedule = _schedule()
    other_schedule.id = "other-daily-pipeline"
    other_schedule.owner_id = "bob"
    store.save(owner_schedule)
    store.save(other_schedule)

    assert store.list(owner_id="alice") == [owner_schedule]
    assert store.get(owner_schedule.id, owner_id="bob") is None
    assert store.delete(owner_schedule.id, owner_id="bob") is False
    assert store.get(owner_schedule.id, owner_id="alice") == owner_schedule
    assert store.delete(owner_schedule.id, owner_id="alice")
    assert store.list(owner_id="bob") == [other_schedule]


def test_run_store_filters_owners_and_persists_results_for_existing_runs(tmp_path):
    store = RunStore(tmp_path)
    owner_run = _run("alice-run", datetime(2026, 7, 29, 2, 0))
    owner_run.owner_id = "alice"
    other_run = _run("bob-run", datetime(2026, 7, 29, 3, 0))
    other_run.owner_id = "bob"
    result = RunResult(
        id="result-1",
        run_id=owner_run.id,
        kind="notebook",
        location="pipelines/daily.ipynb",
        display_name="Daily notebook",
        created_at=datetime(2026, 7, 29, 2, 1),
    )
    store.save(owner_run)
    store.save(other_run)

    assert store.list(owner_id="alice") == [owner_run]
    assert store.get(owner_run.id, owner_id="bob") is None
    assert store.save_result(result) == result
    assert store.list_results(owner_run.id) == [result]
    with pytest.raises(ValueError, match="must exist"):
        store.save_result(
            RunResult(
                id="missing-result",
                run_id="missing-run",
                kind="file",
                location="output.csv",
                display_name="Output",
                created_at=datetime(2026, 7, 29, 2, 2),
            )
        )
