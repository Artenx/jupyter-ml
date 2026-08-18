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

import { showDialog, Dialog } from '@jupyterlab/apputils';

export interface IErrorResponse {
  status?: number;
  message?: string;
  requestPath?: string;
  reason?: string;
  timestamp?: string;
  traceback?: string;
  issues?: object[];
}

/** A class for handling errors when making requests to the Jupyter server. */
export class RequestErrors {
  static serverError(response: IErrorResponse): Promise<Dialog.IResult<void>> {
    if (response.status === 404) {
      return showDialog({
        title: 'Error contacting server',
        body: `Endpoint ${response.requestPath ?? 'unknown'} not found.`,
        buttons: [Dialog.okButton()]
      });
    }

    const reason = response.reason ? response.reason : '';
    const message = response.message ? response.message : '';
    const timestamp = response.timestamp ? response.timestamp : '';
    const detail = reason || message || 'Check the JupyterLab log for more details';

    return showDialog({
      title: 'Error making request',
      body: timestamp ? `${detail} (${timestamp})` : detail,
      buttons: [Dialog.okButton()]
    });
  }
}
