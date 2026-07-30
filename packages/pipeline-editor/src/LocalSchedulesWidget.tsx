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

import { IErrorResponse, RequestErrors } from '@elyra/ui-components';
import { Dialog, ReactWidget, showDialog } from '@jupyterlab/apputils';
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

export const LOCAL_SCHEDULES_WIDGET_ID = 'elyra-local-schedules';

export const formatLocalScheduleTime = (value: string | null): string => {
  return value ? new Date(value).toLocaleString() : 'Not scheduled';
};

export const LocalSchedulesPanel: React.FC = () => {
  const [schedules, setSchedules] = React.useState<ILocalSchedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] =
    React.useState<ILocalSchedule>();
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
    };
    window.addEventListener(LOCAL_SCHEDULES_CHANGED_EVENT, handleChange);
    return () => {
      window.removeEventListener(LOCAL_SCHEDULES_CHANGED_EVENT, handleChange);
    };
  }, [loadSchedules]);

  const selectSchedule = async (schedule: ILocalSchedule): Promise<void> => {
    setSelectedSchedule(schedule);
    await loadRuns(schedule);
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
    if (!selectedRun || !selectedSchedule) {
      return;
    }
    try {
      await LocalScheduleService.deleteRun(selectedRun.id);
      await loadRuns(selectedSchedule);
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
        <button type="button" onClick={() => void loadSchedules()}>
          Refresh
        </button>
      </div>
      {loading ? <p>Loading local schedules...</p> : null}
      {!loading && schedules.length === 0 ? <p>No local schedules.</p> : null}
      <ul className="elyra-localSchedules-list">
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
      {selectedSchedule ? (
        <section className="elyra-localSchedules-detail">
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
                  {run.status} · attempt {run.attempt_number} · {formatLocalScheduleTime(run.started_at ?? run.scheduled_at)}
                </button>
                {run.error_summary ? <p>{run.error_summary}</p> : null}
              </li>
            ))}
          </ul>
          {selectedRun ? (
            <section>
              <h3>Run Logs: {selectedRun.id}</h3>
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
                <button type="button" onClick={() => void retryRun()}>
                  Retry
                </button>
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
  constructor() {
    super();
    this.id = LOCAL_SCHEDULES_WIDGET_ID;
    this.title.label = 'Local Schedules';
    this.addClass('elyra-LocalSchedulesWidget');
  }

  render(): JSX.Element {
    return <LocalSchedulesPanel />;
  }
}
