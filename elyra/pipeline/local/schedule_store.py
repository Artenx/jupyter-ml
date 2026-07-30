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

import json
import os
from pathlib import Path
import tempfile
from typing import List
from typing import Optional

import jupyter_core.paths

from elyra.pipeline.local.models import LocalSchedule


class ScheduleStore:
    """Persists local schedule definitions in the user metadata directory."""

    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or Path(jupyter_core.paths.jupyter_data_dir()) / "metadata" / "local-schedules"
        self.path = self.storage_dir / "schedules.json"

    def list(self) -> List[LocalSchedule]:
        if not self.path.exists():
            return []
        with self.path.open(encoding="utf-8") as file:
            return [LocalSchedule.from_dict(value) for value in json.load(file)]

    def get(self, schedule_id: str) -> Optional[LocalSchedule]:
        return next((schedule for schedule in self.list() if schedule.id == schedule_id), None)

    def save(self, schedule: LocalSchedule) -> LocalSchedule:
        schedules = self.list()
        for index, current in enumerate(schedules):
            if current.id == schedule.id:
                schedules[index] = schedule
                self._write(schedules)
                return schedule
        schedules.append(schedule)
        self._write(schedules)
        return schedule

    def delete(self, schedule_id: str) -> bool:
        schedules = self.list()
        remaining = [schedule for schedule in schedules if schedule.id != schedule_id]
        if len(remaining) == len(schedules):
            return False
        self._write(remaining)
        return True

    def _write(self, schedules: List[LocalSchedule]) -> None:
        self.storage_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=self.storage_dir, prefix="schedules-", suffix=".tmp", delete=False
        ) as file:
            json.dump([schedule.to_dict() for schedule in schedules], file, indent=2)
            temporary_path = file.name
        os.replace(temporary_path, self.path)
