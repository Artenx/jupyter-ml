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

import { LabIcon } from '@jupyterlab/ui-components';

const dockerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <path class="jp-icon3 jp-icon-selectable" fill="#000000" d="M31.5 13.5c-.8-.5-2.6-.7-4-.5-.2-1.4-1-2.6-2.1-3.4l-.8-.5-.5.8c-.7 1-1 2.2-.8 3.4.1.8.4 1.6.9 2.3-1.3.7-3.4.7-4.2.7H1.5c-.8 0-1.5.7-1.5 1.5 0 3 .8 5.9 2.3 8.2 1.5 2.3 3.8 3.8 6.4 4.2 2.6.4 5.9.3 8.4-.3 2.5-.6 4.7-1.8 6.3-3.4 1.6-1.6 2.7-3.6 3.2-5.7h.5c1.8 0 2.9-.8 3.5-1.5.3-.4.6-.8.8-1.3l.2-.9-.6-.3zM3.5 12.5h4v4h-4v-4zm0-5h4v4h-4v-4zm5 5h4v4h-4v-4zm0-5h4v4h-4v-4zm5 5h4v4h-4v-4zm0-5h4v4h-4v-4zm5 5h4v4h-4v-4zm-10-5h4v4h-4v-4zm5 0h4v4h-4v-4z"/>
</svg>`;

export const dockerIcon = new LabIcon({
  name: 'jupyter-ml:docker',
  svgstr: dockerSvg
});
