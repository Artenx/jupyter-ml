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
  IJobSchedulerDialogValue,
  JobSchedulerDialog,
  retentionPolicyFromDialog,
  retryPolicyFromDialog
} from './JobSchedulerDialog';
import {
  ILocalRunLogEntry,
  ILocalScheduledRun,
  ILocalSchedule,
  JobSchedulerService,
  JOB_SCHEDULER_CHANGED_EVENT
} from './JobSchedulerService';
import { IErrorResponse, RequestErrors } from './requestErrors';
import { GenericObjectType } from './types';

export const JOB_SCHEDULER_WIDGET_ID = 'jupyter-ml-job-scheduler';

export const formatJobTime = (value: string | null): string => {
  return value ? new Date(value).toLocaleString() : 'Not scheduled';
};

/** Main-area log view presented with a file-like title for a selected run. */
export class JobRunLogWidget extends ReactWidget {
  private logs: ILocalRunLogEntry[];
  private errorSummary: string | null;

  constructor(run: ILocalScheduledRun, logs: ILocalRunLogEntry[]) {
    super();
    this.logs = logs;
    this.errorSummary = run.error_summary ?? null;
    this.id = `jupyter-ml-local-run-${run.id}-log`;
    this.title.label = formatJobTime(run.started_at ?? run.scheduled_at);
    this.title.caption = 'Local pipeline run log';
    this.title.closable = true;
    this.addClass('jupyter-ml-JobRunLogWidget');
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
    return (
      <>
        {this.errorSummary ? (
          <p className="jupyter-ml-jobScheduler-error">{this.errorSummary}</p>
        ) : null}
        <pre className="jupyter-ml-jobScheduler-logs">{content || 'No log entries.'}</pre>
      </>
    );
  }
}

/** Open the create-local-schedule dialog for the supplied pipeline. */
export const promptCreateJob = async (options: {
  pipelineJson: GenericObjectType;
  pipelinePath: string;
}): Promise<void> => {
  const pipelineName = PathExt.basename(
    options.pipelinePath,
    PathExt.extname(options.pipelinePath)
  );
  const result = await showDialog({
    title: 'Create Job',
    body: formDialogWidget(
      <JobSchedulerDialog displayName={pipelineName || 'Local pipeline'} />
    ),
    buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Create' })],
    defaultButton: 1,
    focusNodeSelector: '#job_name'
  });
  if (!result.button.accept || !result.value) {
    return;
  }
  try {
    await JobSchedulerService.createSchedule({
      display_name: result.value.display_name,
      pipeline_definition: options.pipelineJson,
      cron_expression: result.value.cron_expression,
      enabled: result.value.enabled,
      retry_policy: retryPolicyFromDialog(
        result.value as unknown as IJobSchedulerDialogValue
      ),
      retention_policy: retentionPolicyFromDialog(
        result.value as unknown as IJobSchedulerDialogValue
      )
    });
    window.dispatchEvent(new Event(JOB_SCHEDULER_CHANGED_EVENT));
  } catch (error) {
    await RequestErrors.serverError(error as IErrorResponse);
  }
};

interface IJobSchedulerPanelProps {
  onCreate?: () => Promise<void>;
  onOpenLogs?: (
    run: ILocalScheduledRun,
    logs: ILocalRunLogEntry[]
  ) => void;
}

export const JobSchedulerPanel: React.FC<IJobSchedulerPanelProps> = ({
  onCreate,
  onOpenLogs
}) => {
  const [schedules, setSchedules] = React.useState<ILocalSchedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] =
    React.useState<ILocalSchedule>();
  const [showDirectRuns, setShowDirectRuns] = React.useState(false);
  const [runs, setRuns] = React.useState<ILocalScheduledRun[]>([]);
  const [selectedRun, setSelectedRun] = React.useState<ILocalScheduledRun>();
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [loading, setLoading] = React.useState(true);
  const [contextMenu, setContextMenu] = React.useState<{
    x: number;
    y: number;
    type: 'schedule' | 'run';
    targetId?: string;
  } | null>(null);

  const loadSchedules = React.useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const nextSchedules = await JobSchedulerService.listSchedules();
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
        setRuns(await JobSchedulerService.listRuns(schedule.id));
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
        void JobSchedulerService.listDirectRuns().then(setRuns);
      }
    };
    window.addEventListener(JOB_SCHEDULER_CHANGED_EVENT, handleChange);
    return () => {
      window.removeEventListener(JOB_SCHEDULER_CHANGED_EVENT, handleChange);
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
      setRuns(await JobSchedulerService.listDirectRuns());
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
      title: 'Edit Job',
      body: formDialogWidget(
        <JobSchedulerDialog
          displayName={selectedSchedule.display_name}
          cronExpression={selectedSchedule.cron_expression}
          enabled={selectedSchedule.enabled}
          retryPolicy={selectedSchedule.retry_policy}
          retentionPolicy={selectedSchedule.retention_policy}
        />
      ),
      buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Save' })]
    });
    if (!result.button.accept || !result.value) {
      return;
    }
    try {
      const updated = await JobSchedulerService.updateSchedule(
        selectedSchedule.id,
        {
          ...result.value,
          retry_policy: retryPolicyFromDialog(
            result.value as unknown as IJobSchedulerDialogValue
          ),
          retention_policy: retentionPolicyFromDialog(
            result.value as unknown as IJobSchedulerDialogValue
          )
        }
      );
      window.dispatchEvent(new Event(JOB_SCHEDULER_CHANGED_EVENT));
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
      const updated = await JobSchedulerService.updateSchedule(
        selectedSchedule.id,
        { enabled: !selectedSchedule.enabled }
      );
      window.dispatchEvent(new Event(JOB_SCHEDULER_CHANGED_EVENT));
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
      title: 'Delete Job',
      body: `Delete '${selectedSchedule.display_name}'?`,
      buttons: [Dialog.cancelButton(), Dialog.warnButton({ label: 'Delete' })]
    });
    if (!result.button.accept) {
      return;
    }
    try {
      await JobSchedulerService.deleteSchedule(selectedSchedule.id);
      setSelectedSchedule(undefined);
      setRuns([]);
      setSelectedRun(undefined);
      window.dispatchEvent(new Event(JOB_SCHEDULER_CHANGED_EVENT));
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const loadLogs = async (run: ILocalScheduledRun): Promise<void> => {
    try {
      const nextLogs = await JobSchedulerService.getLogs(run.id);
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
      await JobSchedulerService.runNow(selectedSchedule.id);
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
      await JobSchedulerService.retryRun(selectedRun.id);
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
      await JobSchedulerService.stopRun(selectedRun.id);
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
      await JobSchedulerService.deleteRun(selectedRun.id);
      if (selectedSchedule) {
        await loadRuns(selectedSchedule);
      } else if (showDirectRuns) {
        await selectDirectRuns();
      }
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const deleteRunById = async (runId: string): Promise<void> => {
    const result = await showDialog({
      title: 'Delete Run',
      body: 'Delete this run record? This action cannot be undone.',
      buttons: [Dialog.cancelButton(), Dialog.warnButton({ label: 'Delete' })]
    });
    if (!result.button.accept) {
      return;
    }
    try {
      await JobSchedulerService.deleteRun(runId);
      if (selectedSchedule) {
        await loadRuns(selectedSchedule);
      } else if (showDirectRuns) {
        await selectDirectRuns();
      }
      if (selectedRun?.id === runId) {
        setSelectedRun(undefined);
      }
    } catch (error) {
      await RequestErrors.serverError(error as IErrorResponse);
    }
  };

  const visibleRuns = runs.filter(
    (run) => statusFilter === 'all' || run.status === statusFilter
  );

  const handleScheduleContextMenu = (
    event: React.MouseEvent,
    schedule: ILocalSchedule
  ): void => {
    event.preventDefault();
    setSelectedSchedule(schedule);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: 'schedule',
      targetId: schedule.id
    });
  };

  const handleRunContextMenu = (
    event: React.MouseEvent,
    run: ILocalScheduledRun
  ): void => {
    event.preventDefault();
    setSelectedRun(run);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      type: 'run',
      targetId: run.id
    });
  };

  const closeContextMenu = (): void => {
    setContextMenu(null);
  };

  React.useEffect(() => {
    const handleClick = (): void => {
      closeContextMenu();
    };
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => {
        document.removeEventListener('click', handleClick);
      };
    }
    return undefined;
  }, [contextMenu]);

  return (
    <div className="jupyter-ml-jobScheduler">
      <div className="jupyter-ml-jobScheduler-header">
        {onCreate ? (
          <button className="jp-mod-styled" type="button" onClick={() => void onCreate()}>
            Create Job
          </button>
        ) : null}
        <button className="jp-mod-styled" type="button" onClick={() => void loadSchedules()}>
          Refresh
        </button>
      </div>
      {loading ? <p className="jupyter-ml-jobScheduler-empty">Loading jobs...</p> : null}
      {!loading && schedules.length === 0 ? (
        <p className="jupyter-ml-jobScheduler-empty">
          No jobs. Create one from the Pipeline Editor toolbar or
          from here using an open Local pipeline.
        </p>
      ) : null}
      <div className="jupyter-ml-jobScheduler-directRuns">
        <button
          type="button"
          className={showDirectRuns ? 'is-selected' : ''}
          onClick={() => void selectDirectRuns()}
        >
          <span className="jupyter-ml-jobScheduler-itemTitle">Direct Runs</span>
          <span className="jupyter-ml-jobScheduler-itemMeta">Run Pipeline history</span>
          <span className="jupyter-ml-jobScheduler-itemRow">
            <span className="jupyter-ml-status is-enabled">Active</span>
            <span className="jupyter-ml-jobScheduler-itemMeta">On-demand runs</span>
          </span>
        </button>
      </div>
      <ul className="jupyter-ml-jobScheduler-list">
        {schedules.map((schedule) => (
          <li key={schedule.id}>
            <button
              type="button"
              className={
                selectedSchedule?.id === schedule.id ? 'is-selected' : ''
              }
              onClick={() => void selectSchedule(schedule)}
              onContextMenu={(event) => handleScheduleContextMenu(event, schedule)}
            >
              <span className="jupyter-ml-jobScheduler-itemTitle">{schedule.display_name}</span>
              <span className="jupyter-ml-jobScheduler-itemMeta">{schedule.cron_expression}</span>
              <span className="jupyter-ml-jobScheduler-itemRow">
                <span className={`jupyter-ml-status is-${schedule.enabled ? 'enabled' : 'disabled'}`}>
                  {schedule.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <span className="jupyter-ml-jobScheduler-itemMeta">Next: {formatJobTime(schedule.next_run_at)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {selectedSchedule || showDirectRuns ? (
        <section className="jupyter-ml-jobScheduler-detail">
          <div className="jupyter-ml-jobScheduler-runHeader">
            <h3>Run History</h3>
            <label>
              Status
              <select className="jp-mod-styled" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
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
          {visibleRuns.length === 0 ? <p className="jupyter-ml-jobScheduler-empty">No runs recorded.</p> : null}
          <ul className="jupyter-ml-jobScheduler-runs">
            {visibleRuns.map((run) => (
              <li key={run.id}>
                <div className="jupyter-ml-jobScheduler-runItem">
                  <button type="button" onClick={() => void loadLogs(run)} onContextMenu={(event) => handleRunContextMenu(event, run)}>
                    <span className="jupyter-ml-jobScheduler-itemRow">
                      <span className={`jupyter-ml-status is-${run.status}`}>{run.status}</span>
                      <span className="jupyter-ml-jobScheduler-itemMeta">
                        {run.trigger_type} · attempt {run.attempt_number} · {formatJobTime(run.started_at ?? run.scheduled_at)}
                      </span>
                    </span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {contextMenu ? (
        <div
          className="jupyter-ml-jobScheduler-contextMenu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'schedule' && selectedSchedule ? (
            <>
              <button type="button" onClick={() => { closeContextMenu(); void editSchedule(); }}>
                Edit
              </button>
              <button type="button" onClick={() => { closeContextMenu(); void runNow(); }}>
                Run now
              </button>
              <button type="button" onClick={() => { closeContextMenu(); void toggleSchedule(); }}>
                {selectedSchedule.enabled ? 'Disable' : 'Enable'}
              </button>
              <button type="button" onClick={() => { closeContextMenu(); void deleteSchedule(); }}>
                Delete
              </button>
            </>
          ) : null}
          {contextMenu.type === 'run' && selectedRun ? (
            <>
              {selectedSchedule ? (
                <button type="button" onClick={() => { closeContextMenu(); void retryRun(); }}>
                  Retry
                </button>
              ) : null}
              {selectedRun.status === 'queued' || selectedRun.status === 'running' ? (
                <button type="button" onClick={() => { closeContextMenu(); void stopRun(); }}>
                  Stop
                </button>
              ) : null}
              <button type="button" onClick={() => { closeContextMenu(); void deleteRunById(selectedRun.id); }}>
                Delete
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/** Sidebar widget for listing and managing persistent jobs. */
export class JobSchedulerWidget extends ReactWidget {
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
    this.id = JOB_SCHEDULER_WIDGET_ID;
    this.title.caption = 'Jobs';
    this.addClass('jupyter-ml-JobSchedulerWidget');
  }

  render(): JSX.Element {
    return (
      <JobSchedulerPanel
        onCreate={this.onCreate}
        onOpenLogs={this.onOpenLogs}
      />
    );
  }
}
