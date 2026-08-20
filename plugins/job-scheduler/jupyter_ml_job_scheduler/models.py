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

from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from datetime import datetime
from datetime import timedelta
from typing import Any
from typing import ClassVar
from typing import Dict
from typing import Optional


def _datetime_from_string(value: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(value) if value else None


def _datetime_to_string(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


class CronExpression:
    """Validates and evaluates five-field Cron expressions."""

    _fields: ClassVar[tuple[tuple[int, int], ...]] = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))

    def __init__(self, expression: str):
        if not isinstance(expression, str):
            raise ValueError("Cron expression must be a string.")

        fields = expression.split()
        if len(fields) != len(self._fields):
            raise ValueError("Cron expression must contain five fields.")

        self.expression = expression
        self._values = tuple(
            self._parse_field(field, minimum, maximum) for field, (minimum, maximum) in zip(fields, self._fields)
        )

    @staticmethod
    def _parse_field(field: str, minimum: int, maximum: int) -> set[int]:
        values: set[int] = set()
        for part in field.split(","):
            values.update(CronExpression._parse_part(part, minimum, maximum))
        if not values:
            raise ValueError(f"Cron field '{field}' must select at least one value.")
        return values

    @staticmethod
    def _parse_part(part: str, minimum: int, maximum: int) -> set[int]:
        range_part, separator, step_part = part.partition("/")
        if separator:
            if not step_part.isdigit() or int(step_part) < 1:
                raise ValueError(f"Cron step '{step_part}' must be a positive integer.")
            step = int(step_part)
        else:
            step = 1

        if range_part == "*":
            start, end = minimum, maximum
        elif "-" in range_part:
            start_text, end_text = range_part.split("-", 1)
            start = CronExpression._parse_value(start_text, minimum, maximum)
            end = CronExpression._parse_value(end_text, minimum, maximum)
            if start > end:
                raise ValueError(f"Cron range '{range_part}' must be ascending.")
        else:
            if separator:
                raise ValueError(f"Cron step '{part}' requires '*' or a range.")
            value = CronExpression._parse_value(range_part, minimum, maximum)
            return {value}

        return set(range(start, end + 1, step))

    @staticmethod
    def _parse_value(value: str, minimum: int, maximum: int) -> int:
        if not value.isdigit():
            raise ValueError(f"Cron value '{value}' must be an integer.")
        parsed = int(value)
        if parsed < minimum or parsed > maximum:
            raise ValueError(f"Cron value '{value}' must be between {minimum} and {maximum}.")
        return parsed

    def matches(self, value: datetime) -> bool:
        minute, hour, day, month, day_of_week = self._values
        cron_day_of_week = (value.weekday() + 1) % 7
        return (
            value.minute in minute
            and value.hour in hour
            and value.day in day
            and value.month in month
            and (cron_day_of_week in day_of_week or (cron_day_of_week == 0 and 7 in day_of_week))
        )

    def next_after(self, value: datetime) -> datetime:
        candidate = value.replace(second=0, microsecond=0) + timedelta(minutes=1)
        for _ in range(527040):
            if self.matches(candidate):
                return candidate
            candidate += timedelta(minutes=1)
        raise ValueError(f"Cron expression '{self.expression}' has no trigger within one year.")


@dataclass
class RetryPolicy:
    """Defines automatic retry behavior for a local pipeline task."""

    max_attempts: int = 3
    initial_delay_seconds: int = 60
    backoff_multiplier: float = 2

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("Retry policy max_attempts must be at least 1.")
        if self.initial_delay_seconds < 0:
            raise ValueError("Retry policy initial_delay_seconds must be non-negative.")
        if self.backoff_multiplier < 1:
            raise ValueError("Retry policy backoff_multiplier must be at least 1.")

    @classmethod
    def from_dict(cls, value: Optional[Dict[str, Any]]) -> "RetryPolicy":
        return cls(**value) if value else cls()


@dataclass
class RetentionPolicy:
    """Defines history retention behavior for a local pipeline task."""

    retention_mode: str = "records"  # "records" or "days"
    max_records: int = 100
    retention_days: int = 90

    def __post_init__(self) -> None:
        if self.retention_mode not in {"records", "days"}:
            raise ValueError("Retention policy retention_mode must be 'records' or 'days'.")
        if self.max_records < 1:
            raise ValueError("Retention policy max_records must be at least 1.")
        if self.retention_days < 1:
            raise ValueError("Retention policy retention_days must be at least 1.")

    @classmethod
    def from_dict(cls, value: Optional[Dict[str, Any]]) -> "RetentionPolicy":
        return cls(**value) if value else cls()


@dataclass
class LocalSchedule:
    id: str
    display_name: str
    pipeline_definition: Dict[str, Any]
    cron_expression: str
    enabled: bool
    created_at: datetime
    updated_at: datetime
    next_run_at: Optional[datetime] = None
    owner_id: str = "default"
    retry_policy: RetryPolicy = field(default_factory=RetryPolicy)
    retention_policy: RetentionPolicy = field(default_factory=RetentionPolicy)
    kernel_name: Optional[str] = None

    def __post_init__(self) -> None:
        CronExpression(self.cron_expression)
        if not self.owner_id:
            raise ValueError("Local schedule owner_id must be non-empty.")

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result["created_at"] = _datetime_to_string(self.created_at)
        result["updated_at"] = _datetime_to_string(self.updated_at)
        result["next_run_at"] = _datetime_to_string(self.next_run_at)
        return result

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "LocalSchedule":
        return cls(
            id=value["id"],
            display_name=value["display_name"],
            pipeline_definition=value["pipeline_definition"],
            cron_expression=value["cron_expression"],
            enabled=value["enabled"],
            created_at=_datetime_from_string(value["created_at"]),
            updated_at=_datetime_from_string(value["updated_at"]),
            next_run_at=_datetime_from_string(value.get("next_run_at")),
            owner_id=value.get("owner_id", "default"),
            retry_policy=RetryPolicy.from_dict(value.get("retry_policy")),
            retention_policy=RetentionPolicy.from_dict(value.get("retention_policy")),
            kernel_name=value.get("kernel_name"),
        )


@dataclass
class LocalScheduledRun:
    id: str
    schedule_id: Optional[str]
    status: str
    scheduled_at: datetime
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    error_summary: Optional[str] = None
    log_path: Optional[str] = None
    owner_id: str = "default"
    trigger_type: str = "scheduled"
    attempt_number: int = 1
    parent_run_id: Optional[str] = None
    remote_kernel_id: Optional[str] = None
    next_retry_at: Optional[datetime] = None
    pipeline_definition: Optional[Dict[str, Any]] = None

    VALID_STATUSES: ClassVar[set[str]] = {
        "queued",
        "scheduled",
        "running",
        "retrying",
        "succeeded",
        "failed",
        "stopped",
        "skipped",
    }
    VALID_TRIGGER_TYPES: ClassVar[set[str]] = {"manual", "scheduled", "retry", "direct"}

    def __post_init__(self) -> None:
        if self.status not in self.VALID_STATUSES:
            raise ValueError(f"Unsupported local scheduled run status '{self.status}'.")
        if self.trigger_type not in self.VALID_TRIGGER_TYPES:
            raise ValueError(f"Unsupported local run trigger type '{self.trigger_type}'.")
        if self.attempt_number < 1:
            raise ValueError("Local scheduled run attempt_number must be at least 1.")
        if not self.owner_id:
            raise ValueError("Local scheduled run owner_id must be non-empty.")

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        for key in ("scheduled_at", "started_at", "finished_at", "next_retry_at"):
            result[key] = _datetime_to_string(result[key])
        return result

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "LocalScheduledRun":
        return cls(
            id=value["id"],
            schedule_id=value.get("schedule_id"),
            status=value["status"],
            scheduled_at=_datetime_from_string(value["scheduled_at"]),
            started_at=_datetime_from_string(value.get("started_at")),
            finished_at=_datetime_from_string(value.get("finished_at")),
            error_summary=value.get("error_summary"),
            log_path=value.get("log_path"),
            owner_id=value.get("owner_id", "default"),
            trigger_type=value.get("trigger_type", "scheduled"),
            attempt_number=value.get("attempt_number", 1),
            parent_run_id=value.get("parent_run_id"),
            remote_kernel_id=value.get("remote_kernel_id"),
            next_retry_at=_datetime_from_string(value.get("next_retry_at")),
            pipeline_definition=value.get("pipeline_definition"),
        )


@dataclass
class RunResult:
    """Describes an output produced by a local pipeline run."""

    id: str
    run_id: str
    kind: str
    location: str
    display_name: str
    created_at: datetime
    operation_name: Optional[str] = None

    VALID_KINDS: ClassVar[set[str]] = {"notebook", "file", "remote_kernel", "link"}

    def __post_init__(self) -> None:
        if self.kind not in self.VALID_KINDS:
            raise ValueError(f"Unsupported run result kind '{self.kind}'.")
        if not self.location:
            raise ValueError("Run result location must be non-empty.")
        if not self.display_name:
            raise ValueError("Run result display_name must be non-empty.")

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result["created_at"] = _datetime_to_string(self.created_at)
        return result

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "RunResult":
        return cls(
            id=value["id"],
            run_id=value["run_id"],
            kind=value["kind"],
            location=value["location"],
            display_name=value["display_name"],
            created_at=_datetime_from_string(value["created_at"]),
            operation_name=value.get("operation_name"),
        )


@dataclass
class RunLogEntry:
    timestamp: datetime
    level: str
    message: str
    operation_name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result["timestamp"] = _datetime_to_string(self.timestamp)
        return result

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "RunLogEntry":
        return cls(
            timestamp=_datetime_from_string(value["timestamp"]),
            level=value["level"],
            message=value["message"],
            operation_name=value.get("operation_name"),
        )
