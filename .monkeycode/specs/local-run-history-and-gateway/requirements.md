# Requirements Document

## Introduction

Elyra persists local pipeline schedules and their run history, but pipeline
executions started directly from the Pipeline Editor ("Run Pipeline") are neither
recorded nor visible in the Local Schedules sidebar.  Direct runs, scheduled
runs, and runs that target an Enterprise Gateway kernel share the same
execution code path and should surface a consistent history, log, and status
experience.

## Glossary

- **Local schedule**: A persisted (`LocalSchedule`) pipeline with a Cron
  expression that triggers recurring executions.
- **Direct run**: A pipeline execution started from the Pipeline Editor
  toolbar ("Run Pipeline") that is not attached to a schedule.
- **Run history**: The set of `LocalScheduledRun` records persisted in
  `RunStore` and listed in the Local Schedules sidebar.
- **Enterprise Gateway**: A remote kernel provider selected automatically by
  `LocalPipelineProcessor` when `JUPYTER_GATEWAY_URL` is configured.

## Requirements

### Requirement 1

**User Story:** AS a pipeline author, I want runs started from the "Run
Pipeline" button to appear in run history, so that I can track progress and
review failures like scheduled runs.

#### Acceptance Criteria

1. WHEN the user submits a Local pipeline from the Pipeline Editor, the
   Pipeline Editor SHALL record a `LocalScheduledRun` with `trigger_type`
   `direct` and `schedule_id` `null`.
2. WHEN a direct run is submitted, the scheduler SHALL execute it on the same
   executor used by scheduled runs so the lifecycle (queued, running,
   succeeded, failed, stopped) is identical.
3. WHEN a direct run fails, the scheduler SHALL NOT enqueue an automatic
   retry, because direct submissions carry a no-retry policy.
4. THE Pipeline Editor SHALL expose a dedicated endpoint that lists only
   direct runs (`schedule_id is null`), distinct from schedule-scoped runs.
5. THE Local Schedules sidebar SHALL list direct runs under a "Direct Runs"
   entry that is independent of created schedules.

### Requirement 2

**User Story:** AS a pipeline author, I want the per-run log displayed as a
document in the main area, so that I can read full output alongside the
pipeline editor.

#### Acceptance Criteria

1. WHEN the user selects a run, the sidebar SHALL offer an action that opens
   the run log as a main-area widget.
2. THE run log widget SHALL render the structured log entries as plain text
   with timestamp, level, operation name, and message.
3. WHEN the same run is reopened after additional log entries are collected,
   the widget SHALL refresh its content without creating a duplicate panel.

### Requirement 3

**User Story:** AS an operator using Enterprise Gateway, I want scheduled and
direct runs to execute on the gateway without separate configuration, so that
notebook kernels run remotely as they do when launched from a notebook.

#### Acceptance Criteria

1. WHEN `GatewayClient.gateway_enabled` is true, the local pipeline processor
   SHALL start notebook kernels via `GatewayKernelManager`.
2. THE Local Schedules sidebar SHALL display the Enterprise Gateway kernel id
   for runs that executed remotely.
3. WHEN a direct run executes on the gateway, the run record SHALL persist the
   `remote_kernel_id` returned by the gateway, identical to scheduled runs.

### Requirement 4

**User Story:** AS a JupyterLab user, I want the Local Schedules sidebar to be
represented by an icon, so that the interface matches the other Elyra sidebars.

#### Acceptance Criteria

1. THE Local Schedules sidebar tab SHALL display the pipeline icon instead of
   a text-only label.
2. THE sidebar SHALL retain a hover caption so users can identify it as Local
   schedules.
