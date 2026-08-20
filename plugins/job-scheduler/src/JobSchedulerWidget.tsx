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
import { ContentsManager } from '@jupyterlab/services';
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
  JOB_SCHEDULER_CHANGED_EVENT,
  getPipelineName
} from './JobSchedulerService';
import { IErrorResponse, RequestErrors } from './requestErrors';
import { GenericObjectType } from './types';

export const JOB_SCHEDULER_WIDGET_ID = 'jupyter-ml-job-scheduler';

export const formatJobTime = (value: string | null): string => {
  return value ? new Date(value).toLocaleString() : 'Not scheduled';
};

/** Main-area log view presented with a file-like title for a selected run. */
export interface ILogPage {
  logs: ILocalRunLogEntry[];
  total: number;
  offset: number;
  limit: number | null;
}

const LOG_PAGE_SIZE = 500;

export class JobRunLogWidget extends ReactWidget {
  private run: ILocalScheduledRun;
  private fetchLogs: (
    offset: number,
    limit: number,
    tail: boolean
  ) => Promise<ILogPage>;
  private logs: ILocalRunLogEntry[] = [];
  private total = 0;
  private loadedStart = 0;
  private loading = false;
  private error: string | null = null;

  constructor(
    run: ILocalScheduledRun,
    fetchLogs: (
      offset: number,
      limit: number,
      tail: boolean
    ) => Promise<ILogPage>
  ) {
    super();
    this.run = run;
    this.fetchLogs = fetchLogs;
    this.id = `jupyter-ml-local-run-${run.id}-log`;
    this.title.label = formatJobTime(run.started_at ?? run.scheduled_at);
    this.title.caption = 'Local pipeline run log';
    this.title.closable = true;
    this.addClass('jupyter-ml-JobRunLogWidget');
    void this.loadInitial();
  }

  private async loadInitial(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.update();
    try {
      const page = await this.fetchLogs(0, LOG_PAGE_SIZE, true);
      this.logs = page.logs;
      this.total = page.total;
      this.loadedStart = page.offset;
    } catch (err) {
      this.error = 'Failed to load logs.';
      console.error('Failed to load run logs:', err);
    } finally {
      this.loading = false;
      this.update();
    }
  }

  private async loadEarlier(): Promise<void> {
    if (this.loading || this.loadedStart <= 0) {
      return;
    }
    this.loading = true;
    this.error = null;
    this.update();
    try {
      const newStart = Math.max(0, this.loadedStart - LOG_PAGE_SIZE);
      const page = await this.fetchLogs(newStart, LOG_PAGE_SIZE, false);
      this.logs = [...page.logs, ...this.logs];
      this.loadedStart = page.offset;
    } catch (err) {
      this.error = 'Failed to load earlier logs.';
      console.error('Failed to load earlier logs:', err);
    } finally {
      this.loading = false;
      this.update();
    }
  }

  render(): JSX.Element {
    const groups = this.groupLogsByOperation();
    const showEarlier = this.loadedStart > 0 && !this.loading;
    return (
      <>
        {this.error ? (
          <p className="jupyter-ml-jobScheduler-error">{this.error}</p>
        ) : null}
        {this.run.error_summary ? (
          <p className="jupyter-ml-jobScheduler-error">{this.run.error_summary}</p>
        ) : null}
        <div className="jupyter-ml-jobScheduler-logMeta">
          {this.loading
            ? 'Loading logs...'
            : this.total > 0
            ? `Showing ${this.logs.length} of ${this.total} log lines`
            : 'No log entries.'}
        </div>
        {showEarlier ? (
          <button
            className="jupyter-ml-jobScheduler-loadEarlier"
            onClick={() => void this.loadEarlier()}
          >
            Load earlier logs
          </button>
        ) : null}
        <div className="jupyter-ml-jobScheduler-logGroups">
          {groups.length === 0 && !this.loading ? (
            <p className="jupyter-ml-jobScheduler-empty">No log entries.</p>
          ) : (
            groups.map((group) => (
              <div
                key={group.name}
                className="jupyter-ml-jobScheduler-logGroup"
              >
                <div className="jupyter-ml-jobScheduler-logGroupHeader">
                  {group.name}
                  <span className="jupyter-ml-jobScheduler-logGroupCount">
                    {group.entries.length}
                  </span>
                </div>
                <div className="jupyter-ml-jobScheduler-logGroupBody">
                  {group.entries.map((entry, idx) => (
                    <div
                      key={idx}
                      className={`jupyter-ml-jobScheduler-logLine jupyter-ml-jobScheduler-logLevel-${
                        entry.level
                      }`}
                    >
                      {`${entry.timestamp} ${entry.level} ${entry.message}`}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </>
    );
  }

  private groupLogsByOperation(): {
    name: string;
    entries: ILocalRunLogEntry[];
  }[] {
    const order: string[] = [];
    const map: Record<string, ILocalRunLogEntry[]> = {};
    for (const entry of this.logs) {
      const name = entry.operation_name ?? 'Pipeline';
      if (!map[name]) {
        map[name] = [];
        order.push(name);
      }
      map[name].push(entry);
    }
    return order.map((name) => ({ name, entries: map[name] }));
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
      kernel_name: result.value.kernel_name || null,
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

/** Navigable file browser for selecting a .pipeline file from any subdirectory. */
const PipelineFileBrowser: React.FC<{
  contentsManager: ContentsManager;
  onSelect: (path: string) => void;
}> = ({ contentsManager, onSelect }) => {
  const [currentDir, setCurrentDir] = React.useState('');
  const [items, setItems] = React.useState<
    { name: string; path: string; type: string }[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedPath, setSelectedPath] = React.useState('');

  const loadDir = React.useCallback(
    async (dir: string) => {
      setLoading(true);
      setError(null);
      try {
        const model = await contentsManager.get(dir, { content: true });
        if (model.type === 'directory' && model.content) {
          const entries = (model.content as any[])
            .filter(
              (item: any) =>
                item.type === 'directory' || item.name.endsWith('.pipeline')
            )
            .map((item: any) => ({
              name: item.name,
              path: item.path,
              type: item.type
            }))
            .sort((a: any, b: any) => {
              if (a.type !== b.type) {
                return a.type === 'directory' ? -1 : 1;
              }
              return a.name.localeCompare(b.name);
            });
          setItems(entries);
          setCurrentDir(dir);
        }
      } catch (err) {
        setError(`Failed to list "${dir || '/'}"`);
        console.error('Failed to list directory:', err);
      } finally {
        setLoading(false);
      }
    },
    [contentsManager]
  );

  React.useEffect(() => {
    loadDir('');
  }, [loadDir]);

  const segments = currentDir ? currentDir.split('/') : [];

  return (
    <div className="jupyter-ml-jobScheduler-fileBrowser">
      <div className="jupyter-ml-jobScheduler-breadcrumb">
        <span
          className="jupyter-ml-jobScheduler-crumb"
          onClick={() => loadDir('')}
        >
          /
        </span>
        {segments.map((seg, i) => {
          const p = segments.slice(0, i + 1).join('/');
          return (
            <span key={p}>
              <span className="jupyter-ml-jobScheduler-sep">/</span>
              <span
                className="jupyter-ml-jobScheduler-crumb"
                onClick={() => loadDir(p)}
              >
                {seg}
              </span>
            </span>
          );
        })}
      </div>
      {error ? (
        <p className="jupyter-ml-jobScheduler-error">{error}</p>
      ) : loading ? (
        <p className="jupyter-ml-jobScheduler-empty">Loading...</p>
      ) : items.length === 0 ? (
        <p className="jupyter-ml-jobScheduler-empty">
          No pipeline files or folders here.
        </p>
      ) : (
        <ul className="jupyter-ml-jobScheduler-fileList">
          {items.map((item) => {
            const isDir = item.type === 'directory';
            const cls =
              'jupyter-ml-jobScheduler-fileItem ' +
              (isDir ? 'is-dir' : 'is-file') +
              (selectedPath === item.path ? ' is-selected' : '');
            return (
              <li
                key={item.path}
                className={cls}
                onClick={() => {
                  if (isDir) {
                    loadDir(item.path);
                  } else {
                    setSelectedPath(item.path);
                    onSelect(item.path);
                  }
                }}
              >
                {item.name}
              </li>
            );
          })}
        </ul>
      )}
      {selectedPath ? (
        <div className="jupyter-ml-jobScheduler-selectedPath">
          Selected: {selectedPath}
        </div>
      ) : null}
    </div>
  );
};

/** Show a file picker dialog to select a .pipeline file from any subdirectory. */
export const promptSelectPipelineFile = async (
  contentsManager: ContentsManager
): Promise<string | null> => {
  let selectedFile = '';

  const result = await showDialog({
    title: 'Select Pipeline File',
    body: (
      <PipelineFileBrowser
        contentsManager={contentsManager}
        onSelect={(path) => {
          selectedFile = path;
        }}
      />
    ),
    buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Select' })]
  });

  if (result.button.accept && selectedFile) {
    return selectedFile;
  }
  return null;
};

interface IJobSchedulerPanelProps {
  onCreate?: () => Promise<void>;
  onOpenLogs?: (run: ILocalScheduledRun) => void;
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
  const [splitRatio, setSplitRatio] = React.useState(0.5);
  const splitRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);

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
          kernelName={selectedSchedule.kernel_name}
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
          kernel_name: result.value.kernel_name || null,
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
    onOpenLogs?.(run);
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

  const startSplitDrag = (event: React.MouseEvent): void => {
    event.preventDefault();
    draggingRef.current = true;
    const handleMove = (moveEvent: MouseEvent): void => {
      const container = splitRef.current;
      if (!container || !draggingRef.current) {
        return;
      }
      const rect = container.getBoundingClientRect();
      if (rect.height === 0) {
        return;
      }
      const ratio = (moveEvent.clientY - rect.top) / rect.height;
      setSplitRatio(Math.min(0.85, Math.max(0.15, ratio)));
    };
    const handleUp = (): void => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
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
          <button
            className="jp-mod-styled jp-mod-accept"
            type="button"
            onClick={() => void onCreate()}
          >
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
          No jobs. Click Create Job to select a .pipeline file from the workspace.
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
      <div className="jupyter-ml-jobScheduler-split" ref={splitRef}>
        <ul
          className="jupyter-ml-jobScheduler-list"
          style={
            selectedSchedule || showDirectRuns
              ? { flex: `${splitRatio} 1 0%` }
              : { flex: '1 1 0%' }
          }
        >
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
              {getPipelineName(schedule.pipeline_definition) ? (
                <span className="jupyter-ml-jobScheduler-itemMeta">
                  Pipeline: {getPipelineName(schedule.pipeline_definition)}
                </span>
              ) : null}
              <span className="jupyter-ml-jobScheduler-itemMeta">{schedule.cron_expression}</span>
              {schedule.kernel_name ? (
                <span className="jupyter-ml-jobScheduler-itemMeta">Kernel: {schedule.kernel_name}</span>
              ) : null}
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
          <div
            className="jupyter-ml-jobScheduler-splitter"
            onMouseDown={startSplitDrag}
            role="separator"
            aria-orientation="horizontal"
          />
        ) : null}
        {selectedSchedule || showDirectRuns ? (
          <section
            className="jupyter-ml-jobScheduler-detail"
            style={{ flex: `${1 - splitRatio} 1 0%` }}
          >
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
                    {getPipelineName(run.pipeline_definition) ? (
                      <span className="jupyter-ml-jobScheduler-itemMeta">
                        Pipeline: {getPipelineName(run.pipeline_definition)}
                      </span>
                    ) : null}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          </section>
        ) : null}
      </div>
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
  private readonly onOpenLogs: ((run: ILocalScheduledRun) => void) | undefined;

  constructor(options?: {
    onCreate?: () => Promise<void>;
    onOpenLogs?: (run: ILocalScheduledRun) => void;
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
