/*
 * Copyright 2018-2026 Elyra Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Dialog, ReactWidget, showDialog } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import * as React from 'react';

import { formDialogWidget } from './formDialogWidget';
import {
  ILocalScheduleDialogValue,
  LocalScheduleDialog,
  retryPolicyFromDialog
} from './LocalScheduleDialog';
import {
  ILocalRunLogEntry,
  ILocalRunResult,
  ILocalScheduledRun,
  ILocalSchedule,
  LocalScheduleService,
  LOCAL_SCHEDULES_CHANGED_EVENT
} from './LocalScheduleService';
import { IErrorResponse, RequestErrors } from './requestErrors';
import { GenericObjectType } from './types';

export const LOCAL_SCHEDULES_WIDGET_ID = 'jupyter-ml-local-schedules';

export const formatLocalScheduleTime = (value: string | null): string => {
  return value ? new Date(value).toLocaleString() : 'Not scheduled';
};

/** Main-area log view presented with a file-like title for a selected run. */
export class LocalRunLogWidget extends ReactWidget {
  private logs: ILocalRunLogEntry[];

  constructor(run: ILocalScheduledRun, logs: ILocalRunLogEntry[]) {
    super();
    this.logs = logs;
    this.id = `jupyter-ml-local-run-${run.id}-log`;
    this.title.label = `${run.id}.log`;
    this.title.caption = 'Local pipeline run log';
    this.addClass('elyra-LocalRunLogWidget');
  }

  setLogs(logs: ILocalRunLogEntry[]): void {
    this.logs = logs;
    this.update();
  }

  render(): JSX.Element {
    const content = this.logs
      .map(
        (entry) =>
          `${entry.timestamp} ${entry.level} ${entry.operation_name ?? ''} ${entry.message}`
      )
      .join('\n');
    return <pre className="elyra-localSchedules-logs">{content || 'No log entries.'}</pre>;
  }
}

/** Open the create-local-schedule dialog for the supplied pipeline. */
export const promptCreateLocalSchedule = async (options: {
  pipelineJson: GenericObjectType;
  pipelinePath: string;
}): Promise<void> => {
  const pipelineName = PathExt.basename(
    options.pipelinePath,
    PathExt.extname(options.pipelinePath)
  );
  const result = await showDialog({
    title: 'Create Local Schedule',
    body: formDialogWidget(
      <LocalScheduleDialog displayName={pipelineName || 'Local pipeline'} />
    ),
    buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Create' })],
    defaultButton: 1,
    focusNodeSelector: '#local_schedule_name'
  });
  if (!result.button.accept || !result.value) {
    return;
  }
  try {
    await LocalScheduleService.createSchedule({
      display_name: result.value.display_name,
      pipeline_definition: options.pipelineJson,
      cron_expression: result.value.cron_expression,
      enabled: result.value.enabled,
      retry_policy: retryPolicyFromDialog(
        result.value as unknown as ILocalScheduleDialogValue
      )
    });
    window.dispatchEvent(new Event(LOCAL_SCHEDULES_CHANGED_EVENT));
  } catch (error) {
    await RequestErrors.serverError(error as IErrorResponse);
  }
};

interface ILocalSchedulesPanelProps {
  onCreate?: () => Promise<void>;
  onOpenLogs?: (
    run: ILocalScheduledRun,
    logs: ILocalRunLogEntry[]
  ) => void;
}

export const LocalSchedulesPanel: React.FC<ILocalSchedulesPanelProps> = ({
  onCreate,
  onOpenLogs
}) => {
  const [schedules, setSchedules] = React.useState<ILocalSchedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] =
    React.useState<ILocalSchedule>();
  const [showDirectRuns, setShowDirectRuns] = React.useState(false);
  const [runs, setRuns] = React.useState<ILocalScheduledRun[]>([]);
  const [logs, setLogs] = React.useState<ILocalRunLogEntry[]>([]);
  const [results, setResults] = React.useState<ILocalRunResult[]>([]);
  const [selectedRun, setSelectedRun] = React.useState<ILocalScheduledRun>();
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [loading, setLoading] = React.useState(true);

  const loadSchedules = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const nextSchedules = await LocalScheduleService.listSchedules();
      setSchedules(nextSchedules);
      setSelectedSchedule((current) =>
        nextSchedules.find((schedule) => schedule.id === current?.id)
      );
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRuns = React.useCallback(
    async (schedule: ILocalSchedule): Promise<void> => {
      try {
        setRuns(await LocalScheduleService.listRuns(schedule.id));
        setLogs([]);
        setResults([]);
        setSelectedRun(undefined);
      } catch (error) {
        await RequestErrors.serverError(error as IErrorResponse);
      }
    },
    []
  );

  React.useEffect(() => {
    void loadSchedules();
    const handleChange = (): void => {
      void loadSchedules();
      if (showDirectRuns) {
        void LocalScheduleService.listDirectRuns().then(setRuns);
      }
    };
    window.addEventListener(LOCAL_SCHEDULES_CHANGED_EVENT, handleChange);
    return () => {
      window.removeEventListener(LOCAL_SCHEDULES_CHANGED_EVENT, handleChange);
    };
  }, [loadSchedules, showDirectRuns]);

  const selectSchedule = async (schedule: ILocalSchedule): Promise<void> => {
    setShowDirectRuns(false);
    setSelectedSchedule(schedule);
    await loadRuns(schedule);
  };

  const selectDirectRuns = async (): Promise<void> => {
    try {
      setShowDirectRuns(true);
      setSelectedSchedule(undefined);
      setRuns(await LocalScheduleService.listDirectRuns());
      setLogs([]);
      setResults([]);
      setSelectedRun(undefined);
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const editSchedule = async (): Promise<void> => {
    if (!selectedSchedule) {
      return;
    }
    const result = await showDialog({
      title: 'Edit Local Schedule',
      body: formDialogWidget(
        <LocalScheduleDialog
          displayName={selectedSchedule.display_name}
          cronExpression={selectedSchedule.cron_expression}
          enabled={selectedSchedule.enabled}
          retryPolicy={selectedSchedule.retry_policy}
        />
      ),
      buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Save' })]
    });
    if (!result.button.accept || !result.value) {
      return;
    }
    try {
      const updated = await LocalScheduleService.updateSchedule(
        selectedSchedule.id,
        {
          ...result.value,
          retry_policy: retryPolicyFromDialog(
            result.value as unknown as ILocalScheduleDialogValue
          )
        }
      );
      window.dispatchEvent(new Event(LOCAL_SCHEDULES_CHANGED_EVENT));
      if (updated) {
        setSelectedSchedule(updated);
        await loadRuns(updated);
      }
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const toggleSchedule = async (): Promise<void> => {
    if (!selectedSchedule) {
      return;
    }
    try {
      const updated = await LocalScheduleService.updateSchedule(
        selectedSchedule.id,
        { enabled: !selectedSchedule.enabled }
      );
      window.dispatchEvent(new Event(LOCAL_SCHEDULES_CHANGED_EVENT));
      if (updated) {
        setSelectedSchedule(updated);
      }
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const deleteSchedule = async (): Promise<void> => {
    if (!selectedSchedule) {
      return;
    }
    const result = await showDialog({
      title: 'Delete Local Schedule',
      body: `Delete '${selectedSchedule.display_name}'?`,
      buttons: [Dialog.cancelButton(), Dialog.warnButton({ label: 'Delete' })]
    });
    if (!result.button.accept) {
      return;
    }
    try {
      await LocalScheduleService.deleteSchedule(selectedSchedule.id);
      setSelectedSchedule(undefined);
      setRuns([]);
      setLogs([]);
      setResults([]);
      setSelectedRun(undefined);
      window.dispatchEvent(new Event(LOCAL_SCHEDULES_CHANGED_EVENT));
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const loadLogs = async (run: ILocalScheduledRun): Promise<void> => {
    try {
      const [nextLogs, nextResults] = await Promise.all([
        LocalScheduleService.getLogs(run.id),
        LocalScheduleService.getResults(run.id)
      ]);
      setLogs(nextLogs);
      setResults(nextResults);
      setSelectedRun(run);
      onOpenLogs?.(run, nextLogs);
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const runNow = async (): Promise<void> => {
    if (!selectedSchedule) {
      return;
    }
    try {
      await LocalScheduleService.runNow(selectedSchedule.id);
      await loadRuns(selectedSchedule);
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const retryRun = async (): Promise<void> => {
    if (!selectedRun || !selectedSchedule) {
      return;
    }
    try {
      await LocalScheduleService.retryRun(selectedRun.id);
      await loadRuns(selectedSchedule);
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const stopRun = async (): Promise<void> => {
    if (!selectedRun || !selectedSchedule) {
      return;
    }
    try {
      await LocalScheduleService.stopRun(selectedRun.id);
      await loadRuns(selectedSchedule);
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const deleteRun = async (): Promise<void> => {
    if (!selectedRun) {
      return;
    }
    try {
      await LocalScheduleService.deleteRun(selectedRun.id);
      if (selectedSchedule) {
        await loadRuns(selectedSchedule);
      } else if (showDirectRuns) {
        await selectDirectRuns();
      }
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const visibleRuns = runs.filter(
    (run) => statusFilter === 'all' || run.status === statusFilter
  );

  return (
    <div className="elyra-localSchedules">
      <div className="elyra-localSchedules-header">
        {onCreate ? (
          <button type="button" onClick={() => void onCreate()}>
            Create Local Schedule
          </button>
        ) : null}
        <button type="button" onClick={() => void loadSchedules()}>
          Refresh
        </button>
      </div>
      {loading ? <p>Loading local schedules...</p> : null}
      {!loading && schedules.length === 0 ? (
        <p>
          No local schedules. Create one from the Pipeline Editor toolbar or
          from here using an open Local pipeline.
        </p>
      ) : null}
      <ul className="elyra-localSchedules-list">
        <li>
          <button
            type="button"
            className={showDirectRuns ? 'is-selected' : ''}
            onClick={() => void selectDirectRuns()}
          >
            <strong>Direct Runs</strong>
            <span>Run Pipeline history</span>
          </button>
        </li>
        {schedules.map((schedule) => (
          <li key={schedule.id}>
            <button
              type="button"
              className={
                selectedSchedule?.id === schedule.id ? 'is-selected' : ''
              }
              onClick={() => void selectSchedule(schedule)}
            >
              <strong>{schedule.display_name}</strong>
              <span>{schedule.cron_expression}</span>
              <span>{schedule.enabled ? 'Enabled' : 'Disabled'}</span>
              <span>Next: {formatLocalScheduleTime(schedule.next_run_at)}</span>
            </button>
          </li>
        ))}
      </ul>
      {selectedSchedule || showDirectRuns ? (
        <section className="elyra-localSchedules-detail">
          {selectedSchedule ? (
            <div className="elyra-localSchedules-actions">
              <button type="button" onClick={() => void editSchedule()}>
                Edit
              </button>
              <button type="button" onClick={() => void runNow()}>
                Run now
              </button>
              <button type="button" onClick={() => void toggleSchedule()}>
                {selectedSchedule.enabled ? 'Disable' : 'Enable'}
              </button>
              <button type="button" onClick={() => void deleteSchedule()}>
                Delete
              </button>
            </div>
          ) : null}
          <div className="elyra-localSchedules-runHeader">
            <h3>Run History</h3>
            <label>
              Status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="retrying">Retrying</option>
                <option value="succeeded">Succeeded</option>
                <option value="failed">Failed</option>
                <option value="stopped">Stopped</option>
              </select>
            </label>
          </div>
          {visibleRuns.length === 0 ? <p>No runs recorded.</p> : null}
          <ul className="elyra-localSchedules-runs">
            {visibleRuns.map((run) => (
              <li key={run.id}>
                <button type="button" onClick={() => void loadLogs(run)}>
                  {run.status} · {run.trigger_type} · attempt {run.attempt_number} · {formatLocalScheduleTime(run.started_at ?? run.scheduled_at)}
                </button>
                {run.error_summary ? <p>{run.error_summary}</p> : null}
              </li>
            ))}
          </ul>
          {selectedRun ? (
            <section>
              <h3>Run Logs: {selectedRun.id}</h3>
              {selectedRun.remote_kernel_id ? (
                <p>Enterprise Gateway kernel: {selectedRun.remote_kernel_id}</p>
              ) : null}
              {logs.length === 0 ? <p>No log entries.</p> : null}
              {logs.length > 0 ? (
                <pre className="elyra-localSchedules-logs">
                  {logs
                    .map(
                      (entry) =>
                        `${entry.timestamp} ${entry.level} ${entry.operation_name ?? ''} ${entry.message}`
                    )
                    .join('\n')}
                </pre>
              ) : null}
              {results.length > 0 ? (
                <ul className="elyra-localSchedules-results">
                  {results.map((result) => (
                    <li key={result.id}>
                      <a href={result.location} target="_blank" rel="noreferrer">
                        {result.display_name}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="elyra-localSchedules-actions">
                {selectedSchedule ? (
                  <button type="button" onClick={() => void retryRun()}>
                    Retry
                  </button>
                ) : null}
                {selectedRun.status === 'queued' || selectedRun.status === 'running' ? (
                  <button type="button" onClick={() => void stopRun()}>
                    Stop
                  </button>
                ) : null}
                <button type="button" onClick={() => void deleteRun()}>
                  Delete run
                </button>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

/** Sidebar widget for listing and managing persistent local schedules. */
export class LocalSchedulesWidget extends ReactWidget {
  private readonly onCreate: (() => Promise<void>) | undefined;
  private readonly onOpenLogs:
    | ((run: ILocalScheduledRun, logs: ILocalRunLogEntry[]) => void)
    | undefined;

  constructor(options?: {
    onCreate?: () => Promise<void>;
    onOpenLogs?: (run: ILocalScheduledRun, logs: ILocalRunLogEntry[]) => void;
  }) {
    super();
    this.onCreate = options?.onCreate;
    this.onOpenLogs = options?.onOpenLogs;
    this.id = LOCAL_SCHEDULES_WIDGET_ID;
    this.title.caption = 'Local schedules';
    this.addClass('elyra-LocalSchedulesWidget');
  }

  render(): JSX.Element {
    return (
      <LocalSchedulesPanel
        onCreate={this.onCreate}
        onOpenLogs={this.onOpenLogs}
      />
    );
  }
}
