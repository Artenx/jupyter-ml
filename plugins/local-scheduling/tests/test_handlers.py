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
import json
from datetime import datetime
from pathlib import Path
import tempfile
from unittest.mock import patch

from tornado.testing import AsyncHTTPTestCase
from tornado.web import Application

from elyra.pipeline.validation import PipelineValidationManager
from elyra.pipeline.validation import ValidationResponse

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
from jupyter_ml_scheduling.models import LocalScheduledRun
from jupyter_ml_scheduling.models import RunLogEntry
from jupyter_ml_scheduling.models import RunResult
from jupyter_ml_scheduling.scheduler import LocalPipelineScheduler


async def _valid_pipeline_response(*args, **kwargs):
    return ValidationResponse()


class AuthenticatedLocalScheduleCollectionHandler(LocalScheduleCollectionHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalScheduleHandler(LocalScheduleHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalScheduleRunsHandler(LocalScheduleRunsHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalDirectRunsHandler(LocalDirectRunsHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalRunLogsHandler(LocalRunLogsHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalRunHandler(LocalRunHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalRunRetryHandler(LocalRunRetryHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalRunStopHandler(LocalRunStopHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalRunResultsHandler(LocalRunResultsHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class AuthenticatedLocalScheduleRunHandler(LocalScheduleRunHandler):
    def get_current_user(self):
        return "test-user"

    def check_xsrf_cookie(self):
        pass


class TestLocalScheduleHandlers(AsyncHTTPTestCase):
    def setUp(self):
        self._storage = tempfile.TemporaryDirectory()
        self.scheduler = LocalPipelineScheduler(root_dir=self._storage.name)
        self.scheduler.schedule_store.storage_dir = Path(self._storage.name)
        self.scheduler.schedule_store.path = Path(self._storage.name) / "schedules.json"
        self.scheduler.run_store.storage_dir = Path(self._storage.name)
        self.scheduler.run_store.path = Path(self._storage.name) / "runs.json"
        self.scheduler.run_store.logs_dir = Path(self._storage.name) / "logs"
        self.scheduler.run_store.results_path = Path(self._storage.name) / "results.json"
        self.validation_patch = patch.object(PipelineValidationManager, "validate", _valid_pipeline_response)
        self.validation_patch.start()
        super().setUp()

    def tearDown(self):
        super().tearDown()
        self.validation_patch.stop()
        self.scheduler.stop()
        self._storage.cleanup()

    def get_app(self):
        return Application(
            [
                (r"/schedules", AuthenticatedLocalScheduleCollectionHandler),
                (r"/schedules/(?P<schedule_id>[\w.\-]+)/runs", AuthenticatedLocalScheduleRunsHandler),
                (r"/schedules/(?P<schedule_id>[\w.\-]+)/run", AuthenticatedLocalScheduleRunHandler),
                (r"/schedules/(?P<schedule_id>[\w.\-]+)", AuthenticatedLocalScheduleHandler),
                (r"/runs", AuthenticatedLocalDirectRunsHandler),
                (r"/runs/(?P<run_id>[\w.\-]+)/retry", AuthenticatedLocalRunRetryHandler),
                (r"/runs/(?P<run_id>[\w.\-]+)/stop", AuthenticatedLocalRunStopHandler),
                (r"/runs/(?P<run_id>[\w.\-]+)/logs", AuthenticatedLocalRunLogsHandler),
                (r"/runs/(?P<run_id>[\w.\-]+)/results", AuthenticatedLocalRunResultsHandler),
                (r"/runs/(?P<run_id>[\w.\-]+)", AuthenticatedLocalRunHandler),
                (r"/protected/schedules", LocalScheduleCollectionHandler),
            ],
            jupyter_ml_scheduling_scheduler=self.scheduler,
            cookie_secret="test-cookie-secret",
            xsrf_cookies=False,
        )

    def _create_schedule(self):
        payload = {
            "display_name": "Nightly local pipeline",
            "pipeline_definition": {"id": "test-pipeline"},
            "cron_expression": "0 1 * * *",
            "enabled": True,
        }
        response = self.fetch("/schedules", method="POST", body=json.dumps(payload))
        assert response.code == 201
        return json.loads(response.body)

    def test_crud(self):
        created = self._create_schedule()
        assert created["next_run_at"] is not None

        response = self.fetch(f"/schedules/{created['id']}")
        assert json.loads(response.body)["display_name"] == "Nightly local pipeline"

        response = self.fetch(f"/schedules/{created['id']}", method="PUT", body=json.dumps({"enabled": False}))
        updated = json.loads(response.body)
        assert updated["enabled"] is False
        assert updated["next_run_at"] is None

        response = self.fetch(f"/schedules/{created['id']}", method="DELETE")
        assert response.code == 204

    def test_run_history_and_missing_logs(self):
        created = self._create_schedule()
        now = datetime.now()
        run = LocalScheduledRun(
            id="completed-run",
            schedule_id=created["id"],
            status="succeeded",
            scheduled_at=now,
            started_at=now,
            finished_at=now,
            owner_id="test-user",
        )
        self.scheduler.run_store.save(run)
        self.scheduler.run_store.append_log(run, RunLogEntry(now, "INFO", "Started"))
        self.scheduler.run_store.append_log(run, RunLogEntry(now, "INFO", "Finished"))
        response = self.fetch(f"/schedules/{created['id']}/runs?status=succeeded")
        assert [item["id"] for item in json.loads(response.body)["runs"]] == [run.id]
        response = self.fetch("/runs/completed-run/logs")
        assert [entry["message"] for entry in json.loads(response.body)["logs"]] == ["Started", "Finished"]
        assert self.fetch("/runs/missing-run/logs").code == 404

    def test_run_control_results_and_owner_isolation(self):
        created = self._create_schedule()
        now = datetime.now()
        completed_run = LocalScheduledRun(
            id="completed-run",
            schedule_id=created["id"],
            status="succeeded",
            scheduled_at=now,
            owner_id="test-user",
        )
        other_run = LocalScheduledRun(
            id="other-run",
            schedule_id=created["id"],
            status="succeeded",
            scheduled_at=now,
            owner_id="other-user",
        )
        self.scheduler.run_store.save(completed_run)
        self.scheduler.run_store.save(other_run)
        self.scheduler.run_store.save_result(
            RunResult(
                id="result-1",
                run_id=completed_run.id,
                kind="file",
                location="file:///tmp/a",
                display_name="output.txt",
                created_at=now,
            )
        )

        assert self.fetch(f"/runs/{completed_run.id}").code == 200
        assert self.fetch("/runs/other-run").code == 404
        response = self.fetch(f"/runs/{completed_run.id}/results")
        assert json.loads(response.body)["results"][0]["id"] == "result-1"
        assert self.fetch(f"/runs/{completed_run.id}", method="DELETE").code == 204
        assert self.fetch(f"/runs/{completed_run.id}").code == 404

    def test_direct_runs_are_listed_separately_from_schedule_runs(self):
        now = datetime.now()
        created = self._create_schedule()
        scheduled_run = LocalScheduledRun(
            id="scheduled-run",
            schedule_id=created["id"],
            status="succeeded",
            scheduled_at=now,
            owner_id="test-user",
        )
        direct_run = LocalScheduledRun(
            id="direct-run",
            schedule_id=None,
            status="succeeded",
            scheduled_at=now,
            owner_id="test-user",
            trigger_type="direct",
        )
        self.scheduler.run_store.save(scheduled_run)
        self.scheduler.run_store.save(direct_run)

        response = self.fetch("/runs")
        direct_runs = json.loads(response.body)["runs"]
        assert [item["id"] for item in direct_runs] == ["direct-run"]
        assert direct_runs[0]["trigger_type"] == "direct"
        assert direct_runs[0]["schedule_id"] is None

    def test_invalid_cron(self):
        response = self.fetch(
            "/schedules",
            method="POST",
            body=json.dumps({"display_name": "Invalid cron", "pipeline_definition": {}, "cron_expression": "* * *"}),
        )
        assert response.code == 400

    def test_storage_failure_returns_server_error(self):
        with patch.object(self.scheduler, "save_schedule", side_effect=OSError("storage unavailable")):
            response = self.fetch(
                "/schedules",
                method="POST",
                body=json.dumps(
                    {
                        "display_name": "Unavailable storage",
                        "pipeline_definition": {"id": "test-pipeline"},
                        "cron_expression": "0 1 * * *",
                    }
                ),
            )
        assert response.code == 500

    def test_unauthenticated_request_is_rejected(self):
        assert self.fetch("/protected/schedules", follow_redirects=False).code == 403
