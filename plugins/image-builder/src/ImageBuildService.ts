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

import { RequestHandler } from './requestHandler';

export type ImageBuildStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'pushing'
  | 'pushed';

export interface IImageBuild {
  id: string;
  dockerfile_path: string;
  context_path: string;
  image_reference: string;
  status: ImageBuildStatus;
  credential_source: 'admin' | 'user';
  credential_id?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  error_summary?: string;
}

export interface IImageBuildLogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface IRegistryCredentialSummary {
  id: string;
  display_name: string;
  registry_url: string;
  username: string;
  source: 'admin' | 'user';
  updated_at?: string;
}

export interface IImageBuildRequest {
  dockerfile_path: string;
  image_reference: string;
  credential_source: 'admin' | 'user';
  credential_id?: string;
}

export interface IRegistryCredentialRequest {
  display_name: string;
  registry_url: string;
  username: string;
  token?: string;
}

const IMAGES_PATH = 'jupyter-ml/images';

/** Client for the authenticated Dockerfile image builder REST endpoints. */
export class ImageBuildService {
  static async readDockerfile(path: string): Promise<{ path: string; content: string } | undefined> {
    return RequestHandler.makeGetRequest(
      `${IMAGES_PATH}/dockerfiles?path=${encodeURIComponent(path)}`
    );
  }

  static async createDockerfile(path: string, content: string): Promise<{ path: string; content: string } | undefined> {
    return RequestHandler.makePostRequest(`${IMAGES_PATH}/dockerfiles`, JSON.stringify({ path, content }));
  }

  static async saveDockerfile(path: string, content: string): Promise<{ path: string; content: string } | undefined> {
    return RequestHandler.makePutRequest(`${IMAGES_PATH}/dockerfiles`, JSON.stringify({ path, content }));
  }

  static async listBuilds(): Promise<IImageBuild[]> {
    const response = await RequestHandler.makeGetRequest<{ builds: IImageBuild[] }>(`${IMAGES_PATH}/builds`);
    return response?.builds ?? [];
  }

  static async startBuild(request: IImageBuildRequest): Promise<IImageBuild | undefined> {
    return RequestHandler.makePostRequest(`${IMAGES_PATH}/builds`, JSON.stringify(request));
  }

  static async getLogs(buildId: string): Promise<IImageBuildLogEntry[]> {
    const response = await RequestHandler.makeGetRequest<{ logs: IImageBuildLogEntry[] }>(
      `${IMAGES_PATH}/builds/${encodeURIComponent(buildId)}/logs`
    );
    return response?.logs ?? [];
  }

  static async stopBuild(buildId: string): Promise<IImageBuild | undefined> {
    return RequestHandler.makePostRequest(`${IMAGES_PATH}/builds/${encodeURIComponent(buildId)}/stop`, '{}');
  }

  static async pushBuild(buildId: string): Promise<IImageBuild | undefined> {
    return RequestHandler.makePostRequest(`${IMAGES_PATH}/builds/${encodeURIComponent(buildId)}/push`, '{}');
  }

  static async registerRuntimeImage(
    buildId: string,
    displayName: string,
    description: string
  ): Promise<unknown> {
    return RequestHandler.makePostRequest(
      `${IMAGES_PATH}/builds/${encodeURIComponent(buildId)}/runtime-image`,
      JSON.stringify({ display_name: displayName, description })
    );
  }

  static async listCredentials(): Promise<IRegistryCredentialSummary[]> {
    const response = await RequestHandler.makeGetRequest<{ credentials: IRegistryCredentialSummary[] }>(
      `${IMAGES_PATH}/credentials`
    );
    return response?.credentials ?? [];
  }

  static async createCredential(
    credential: IRegistryCredentialRequest
  ): Promise<IRegistryCredentialSummary | undefined> {
    return RequestHandler.makePostRequest(`${IMAGES_PATH}/credentials`, JSON.stringify(credential));
  }

  static async updateCredential(
    credentialId: string,
    credential: IRegistryCredentialRequest
  ): Promise<IRegistryCredentialSummary | undefined> {
    return RequestHandler.makePutRequest(
      `${IMAGES_PATH}/credentials/${encodeURIComponent(credentialId)}`,
      JSON.stringify(credential)
    );
  }

  static async deleteCredential(credentialId: string): Promise<void> {
    await RequestHandler.makeDeleteRequest(`${IMAGES_PATH}/credentials/${encodeURIComponent(credentialId)}`);
  }
}
