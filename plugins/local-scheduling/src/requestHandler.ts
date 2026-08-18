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

import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

/** A service class for making authenticated requests to the Jupyter server. */
export class RequestHandler {
  static async makeGetRequest<T = any>(
    requestPath: string
  ): Promise<T | undefined> {
    return this.makeServerRequest<T>(requestPath, { method: 'GET' });
  }

  static async makePostRequest<T = any>(
    requestPath: string,
    requestBody: any
  ): Promise<T | undefined> {
    return this.makeServerRequest<T>(requestPath, {
      method: 'POST',
      body: requestBody
    });
  }

  static async makePutRequest<T = any>(
    requestPath: string,
    requestBody: any
  ): Promise<T | undefined> {
    return this.makeServerRequest<T>(requestPath, {
      method: 'PUT',
      body: requestBody
    });
  }

  static async makeDeleteRequest<T = any>(
    requestPath: string
  ): Promise<T | undefined> {
    return this.makeServerRequest<T>(requestPath, { method: 'DELETE' });
  }

  static async makeServerRequest<T = any>(
    requestPath: string,
    options: RequestInit & { type?: 'blob' | 'json' | 'text' }
  ): Promise<T | undefined> {
    const settings = ServerConnection.makeSettings();
    const requestUrl = URLExt.join(settings.baseUrl, requestPath);

    const { type = 'json', ...requestInit } = options;

    const response = await ServerConnection.makeRequest(
      requestUrl,
      requestInit,
      settings
    );

    const result = await response[type]();

    if (response.status < 200 || response.status >= 300) {
      throw result;
    }

    if (response.status === 204) {
      return undefined;
    }

    return result as T;
  }
}
