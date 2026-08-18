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
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ICommandPalette, ReactWidget } from '@jupyterlab/apputils';
import * as React from 'react';

import { DockerfileImageBuilderWidget } from './DockerfileImageBuilderWidget';

import '../style/index.css';

const PLUGIN_ID = '@jupyter-ml/image-builder:plugin';
const COMMAND_OPEN_IMAGE_BUILDER = 'jupyter-ml:open-image-builder';
const WIDGET_ID = 'jupyter-ml-image-builder';

/**
 * Initialization data for the image-builder extension.
 */
const extension: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [ICommandPalette],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette
  ): Promise<void> => {
    console.log('Jupyter ML - image-builder extension is activated!');

    let imageBuilderWidget: ReactWidget | undefined;

    const createImageBuilderWidget = (): ReactWidget => {
      if (imageBuilderWidget) {
        return imageBuilderWidget;
      }
      imageBuilderWidget = ReactWidget.create(
        React.createElement(DockerfileImageBuilderWidget)
      );
      imageBuilderWidget.id = WIDGET_ID;
      imageBuilderWidget.title.label = 'Dockerfile Image Builder';
      imageBuilderWidget.title.closable = true;
      imageBuilderWidget.disposed.connect(() => {
        imageBuilderWidget = undefined;
      });
      return imageBuilderWidget;
    };

    app.commands.addCommand(COMMAND_OPEN_IMAGE_BUILDER, {
      label: 'Open Dockerfile Image Builder',
      caption: 'Open the Dockerfile image builder workbench',
      execute: () => {
        const widget = createImageBuilderWidget();
        if (!widget.isAttached) {
          app.shell.add(widget, 'main');
        }
        app.shell.activateById(widget.id);
      }
    });

    palette.addItem({
      command: COMMAND_OPEN_IMAGE_BUILDER,
      category: 'Jupyter ML'
    });
  }
};

export default extension;
