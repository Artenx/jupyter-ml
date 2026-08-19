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

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin,
  ILayoutRestorer
} from '@jupyterlab/application';
import { Dialog, ICommandPalette, showDialog } from '@jupyterlab/apputils';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { ContentsManager } from '@jupyterlab/services';

import { pipelineIcon } from './icons';
import {
  JobRunLogWidget,
  JobSchedulerWidget,
  JOB_SCHEDULER_WIDGET_ID,
  promptCreateJob,
  promptSelectPipelineFile
} from './JobSchedulerWidget';
import { GenericObjectType } from './types';

import '../style/index.css';

const PLUGIN_ID = '@jupyter-ml/job-scheduler:plugin';
const COMMAND_CREATE_LOCAL_SCHEDULE = 'jupyter-ml:create-job';

/**
 * Initialization data for the job-scheduler extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [ICommandPalette, ILayoutRestorer],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    restorer: ILayoutRestorer
  ): Promise<void> => {
    const contentsManager = new ContentsManager();

    const createJobFromActiveEditor = async (): Promise<void> => {
      const widget = app.shell.currentWidget as DocumentWidget | null;
      const path = widget?.context?.path;

      // If there's an active pipeline editor, use it
      if (widget && path && path.endsWith('.pipeline')) {
        const pipelineJson = widget.context.model.toJSON() as GenericObjectType;
        const primaryPipeline =
          pipelineJson?.pipelines?.[0] ?? ({} as GenericObjectType);
        const nodes = primaryPipeline?.nodes as unknown[];
        const runtimeType = (primaryPipeline?.app_data as GenericObjectType)
          ?.runtime_type;
        if (!Array.isArray(nodes) || nodes.length === 0) {
          await showDialog({
            title: 'Create Job',
            body: 'The active pipeline has no nodes. Add nodes before scheduling it.',
            buttons: [Dialog.okButton()]
          });
          return;
        }
        if (runtimeType && runtimeType !== 'LOCAL') {
          await showDialog({
            title: 'Create Job',
            body: 'Only Local pipelines can be scheduled locally. Open a Local pipeline and try again.',
            buttons: [Dialog.okButton()]
          });
          return;
        }
        await promptCreateJob({
          pipelineJson,
          pipelinePath: widget.context.path
        });
        return;
      }

      // Otherwise, show file picker
      const selectedPath = await promptSelectPipelineFile(contentsManager);
      if (!selectedPath) {
        return;
      }

      try {
        const model = await contentsManager.get(selectedPath, {
          content: true
        });
        const pipelineJson = model.content as GenericObjectType;
        const primaryPipeline =
          pipelineJson?.pipelines?.[0] ?? ({} as GenericObjectType);
        const nodes = primaryPipeline?.nodes as unknown[];
        const runtimeType = (primaryPipeline?.app_data as GenericObjectType)
          ?.runtime_type;

        if (!Array.isArray(nodes) || nodes.length === 0) {
          await showDialog({
            title: 'Create Job',
            body: 'The selected pipeline has no nodes.',
            buttons: [Dialog.okButton()]
          });
          return;
        }
        if (runtimeType && runtimeType !== 'LOCAL') {
          await showDialog({
            title: 'Create Job',
            body: 'Only Local pipelines can be scheduled locally.',
            buttons: [Dialog.okButton()]
          });
          return;
        }
        await promptCreateJob({
          pipelineJson,
          pipelinePath: selectedPath
        });
      } catch (error) {
        console.error('Failed to load pipeline file:', error);
        await showDialog({
          title: 'Create Job',
          body: `Failed to load pipeline file: ${selectedPath}`,
          buttons: [Dialog.okButton()]
        });
      }
    };

    app.commands.addCommand(COMMAND_CREATE_LOCAL_SCHEDULE, {
      label: 'Create Job',
      caption: 'Create a schedule for the active Local pipeline',
      execute: createJobFromActiveEditor
    });

    palette.addItem({
      command: COMMAND_CREATE_LOCAL_SCHEDULE,
      category: 'Jupyter ML'
    });

    const jobRunLogWidgets = new Map<string, JobRunLogWidget>();
    const jobSchedulerWidget = new JobSchedulerWidget({
      onCreate: createJobFromActiveEditor,
      onOpenLogs: (run, logs): void => {
        let logWidget = jobRunLogWidgets.get(run.id);
        if (!logWidget || logWidget.isDisposed) {
          if (logWidget && logWidget.isDisposed) {
            jobRunLogWidgets.delete(run.id);
          }
          logWidget = new JobRunLogWidget(run, logs);
          jobRunLogWidgets.set(run.id, logWidget);
          logWidget.disposed.connect(() => jobRunLogWidgets.delete(run.id));
          app.shell.add(logWidget, 'main', { mode: 'tab-after' });
        } else {
          logWidget.setLogs(logs);
          app.shell.add(logWidget, 'main', { mode: 'tab-after' });
        }
        logWidget.activate();
      }
    });
    jobSchedulerWidget.title.icon = pipelineIcon;
    restorer.add(jobSchedulerWidget, JOB_SCHEDULER_WIDGET_ID);
    app.shell.add(jobSchedulerWidget, 'left', { rank: 949 });
  }
};

export default extension;
