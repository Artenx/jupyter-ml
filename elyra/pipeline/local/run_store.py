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

from datetime import datetime
from datetime import timedelta
import json
import os
from pathlib import Path
import tempfile
from typing import Iterable
from typing import List
from typing import Optional

import jupyter_core.paths

from elyra.pipeline.local.models import LocalScheduledRun
from elyra.pipeline.local.models import RunLogEntry
from elyra.pipeline.local.models import RunResult


class RunStore:
    """Persists scheduled runs and their JSON Lines logs."""

    max_records = 100
    retention_days = 90

    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or Path(jupyter_core.paths.jupyter_data_dir()) / "metadata" / "local-schedules"
        self.path = self.storage_dir / "runs.json"
        self.logs_dir = self.storage_dir / "logs"
        self.results_path = self.storage_dir / "results.json"

    def list(self, schedule_id: Optional[str] = None, owner_id: Optional[str] = None) -> List[LocalScheduledRun]:
        if not self.path.exists():
            return []
        with self.path.open(encoding="utf-8") as file:
            runs = [LocalScheduledRun.from_dict(value) for value in json.load(file)]
        if schedule_id:
            runs = [run for run in runs if run.schedule_id == schedule_id]
        if owner_id:
            runs = [run for run in runs if run.owner_id == owner_id]
        return sorted(runs, key=lambda run: run.scheduled_at, reverse=True)

    def get(self, run_id: str, owner_id: Optional[str] = None) -> Optional[LocalScheduledRun]:
        return next((run for run in self.list(owner_id=owner_id) if run.id == run_id), None)

    def save(self, run: LocalScheduledRun, now: Optional[datetime] = None) -> LocalScheduledRun:
        runs = self.list()
        for index, current in enumerate(runs):
            if current.id == run.id:
                runs[index] = run
                self._write(self._prune(runs, now or datetime.now()))
                return run
        runs.append(run)
        self._write(self._prune(runs, now or datetime.now()))
        return run

    def delete(self, run_id: str, owner_id: Optional[str] = None) -> bool:
        """Delete one persisted run after verifying its ownership."""
        runs = self.list()
        remaining = [
            run for run in runs if run.id != run_id or (owner_id is not None and run.owner_id != owner_id)
        ]
        if len(remaining) == len(runs):
            return False
        self._write(remaining)
        self._remove_log(run_id)
        results = [result for result in self._results() if result.run_id != run_id]
        self._write_results(results)
        return True

    def append_log(self, run: LocalScheduledRun, entry: RunLogEntry) -> None:
        self.logs_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        log_path = self.logs_dir / f"{run.id}.jsonl"
        with log_path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(entry.to_dict()) + "\n")

    def logs(self, run_id: str) -> List[RunLogEntry]:
        log_path = self.logs_dir / f"{run_id}.jsonl"
        if not log_path.exists():
            return []
        with log_path.open(encoding="utf-8") as file:
            return [RunLogEntry.from_dict(json.loads(line)) for line in file if line.strip()]

    def list_results(self, run_id: str) -> List[RunResult]:
        if not self.results_path.exists():
            return []
        with self.results_path.open(encoding="utf-8") as file:
            return [RunResult.from_dict(value) for value in json.load(file) if value["run_id"] == run_id]

    def save_result(self, result: RunResult) -> RunResult:
        if self.get(result.run_id) is None:
            raise ValueError(f"Run '{result.run_id}' must exist before saving a result.")
        results = self._results()
        for index, current in enumerate(results):
            if current.id == result.id:
                results[index] = result
                self._write_results(results)
                return result
        results.append(result)
        self._write_results(results)
        return result

    def _results(self) -> List[RunResult]:
        if not self.results_path.exists():
            return []
        with self.results_path.open(encoding="utf-8") as file:
            return [RunResult.from_dict(value) for value in json.load(file)]

    def _prune(self, runs: Iterable[LocalScheduledRun], now: datetime) -> List[LocalScheduledRun]:
        cutoff = now - timedelta(days=self.retention_days)
        retained: List[LocalScheduledRun] = []
        for run in sorted(runs, key=lambda current: current.scheduled_at, reverse=True):
            keep = run.status in {"queued", "scheduled", "running", "retrying"} or (
                len(retained) < self.max_records and run.scheduled_at >= cutoff
            )
            if keep:
                retained.append(run)
            else:
                self._remove_log(run.id)
        return retained

    def _remove_log(self, run_id: str) -> None:
        log_path = self.logs_dir / f"{run_id}.jsonl"
        if log_path.exists():
            log_path.unlink()

    def _write(self, runs: List[LocalScheduledRun]) -> None:
        self.storage_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.storage_dir, prefix="runs-", suffix=".tmp", delete=False
        ) as file:
            json.dump([run.to_dict() for run in runs], file, indent=2)
            temporary_path = file.name
        os.replace(temporary_path, self.path)

    def _write_results(self, results: List[RunResult]) -> None:
        self.storage_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.storage_dir, prefix="results-", suffix=".tmp", delete=False
        ) as file:
            json.dump([result.to_dict() for result in results], file, indent=2)
            temporary_path = file.name
        os.replace(temporary_path, self.results_path)
