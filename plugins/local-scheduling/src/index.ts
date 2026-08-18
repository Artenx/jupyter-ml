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

import { pipelineIcon } from './icons';
import {
  LocalRunLogWidget,
  LocalSchedulesWidget,
  LOCAL_SCHEDULES_WIDGET_ID,
  promptCreateLocalSchedule
} from './LocalSchedulesWidget';
import { GenericObjectType } from './types';

import '../style/index.css';

const PLUGIN_ID = '@jupyter-ml/local-scheduling:plugin';
const COMMAND_CREATE_LOCAL_SCHEDULE = 'jupyter-ml:create-local-schedule';

/**
 * Initialization data for the local-scheduling extension.
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
    const createLocalScheduleFromActiveEditor = async (): Promise<void> => {
      const widget = app.shell.currentWidget as DocumentWidget | null;
      const path = widget?.context?.path;
      if (!widget || !path || !path.endsWith('.pipeline')) {
        await showDialog({
          title: 'Create Local Schedule',
          body: 'Open a pipeline in the Pipeline Editor first, then create a local schedule from here.',
          buttons: [Dialog.okButton()]
        });
        return;
      }
      const pipelineJson = widget.context.model.toJSON() as GenericObjectType;
      const primaryPipeline =
        pipelineJson?.pipelines?.[0] ?? ({} as GenericObjectType);
      const nodes = primaryPipeline?.nodes as unknown[];
      const runtimeType = (primaryPipeline?.app_data as GenericObjectType)
        ?.runtime_type;
      if (!Array.isArray(nodes) || nodes.length === 0) {
        await showDialog({
          title: 'Create Local Schedule',
          body: 'The active pipeline has no nodes. Add nodes before scheduling it.',
          buttons: [Dialog.okButton()]
        });
        return;
      }
      if (runtimeType && runtimeType !== 'LOCAL') {
        await showDialog({
          title: 'Create Local Schedule',
          body: 'Only Local pipelines can be scheduled locally. Open a Local pipeline and try again.',
          buttons: [Dialog.okButton()]
        });
        return;
      }
      await promptCreateLocalSchedule({
        pipelineJson,
        pipelinePath: widget.context.path
      });
    };

    app.commands.addCommand(COMMAND_CREATE_LOCAL_SCHEDULE, {
      label: 'Create Local Schedule',
      caption: 'Create a schedule for the active Local pipeline',
      execute: createLocalScheduleFromActiveEditor
    });

    palette.addItem({
      command: COMMAND_CREATE_LOCAL_SCHEDULE,
      category: 'Jupyter ML'
    });

    const localRunLogWidgets = new Map<string, LocalRunLogWidget>();
    const localSchedulesWidget = new LocalSchedulesWidget({
      onCreate: createLocalScheduleFromActiveEditor,
      onOpenLogs: (run, logs): void => {
        let logWidget = localRunLogWidgets.get(run.id);
        if (!logWidget) {
          logWidget = new LocalRunLogWidget(run, logs);
          localRunLogWidgets.set(run.id, logWidget);
          logWidget.disposed.connect(() => localRunLogWidgets.delete(run.id));
          app.shell.add(logWidget, 'main', { mode: 'split-right' });
        } else {
          logWidget.setLogs(logs);
        }
        logWidget.activate();
      }
    });
    localSchedulesWidget.title.icon = pipelineIcon;
    localSchedulesWidget.title.label = 'Local Schedules';
    restorer.add(localSchedulesWidget, LOCAL_SCHEDULES_WIDGET_ID);
    app.shell.add(localSchedulesWidget, 'left', { rank: 949 });
  }
};

export default extension;
