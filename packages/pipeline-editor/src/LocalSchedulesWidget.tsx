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
import { LocalScheduleDialog } from './LocalScheduleDialog';
import {
  ILocalRunLogEntry,
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
  const [selectedRun, setSelectedRun] = React.useState<ILocalScheduledRun>();
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
        result.value
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
      setSelectedRun(undefined);
      window.dispatchEvent(new Event(LOCAL_SCHEDULES_CHANGED_EVENT));
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const loadLogs = async (run: ILocalScheduledRun): Promise<void> => {
    try {
      setLogs(await LocalScheduleService.getLogs(run.id));
      setSelectedRun(run);
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

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
            <button type="button" onClick={() => void toggleSchedule()}>
              {selectedSchedule.enabled ? 'Disable' : 'Enable'}
            </button>
            <button type="button" onClick={() => void deleteSchedule()}>
              Delete
            </button>
          </div>
          <h3>Run History</h3>
          {runs.length === 0 ? <p>No runs recorded.</p> : null}
          <ul className="elyra-localSchedules-runs">
            {runs.map((run) => (
              <li key={run.id}>
                <button type="button" onClick={() => void loadLogs(run)}>
                  {run.status} {formatLocalScheduleTime(run.started_at ?? run.scheduled_at)}
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
