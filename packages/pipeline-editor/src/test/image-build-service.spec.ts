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

import { RequestHandler } from '@elyra/services';

import { ImageBuildService } from '../ImageBuildService';

describe('@elyra/pipeline-editor', () => {
  describe('ImageBuildService', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('reads, creates, and saves Dockerfiles through encoded workspace paths', async () => {
      const getRequest = jest.spyOn(RequestHandler, 'makeGetRequest').mockResolvedValue(undefined);
      const postRequest = jest.spyOn(RequestHandler, 'makePostRequest').mockResolvedValue(undefined);
      const putRequest = jest.spyOn(RequestHandler, 'makePutRequest').mockResolvedValue(undefined);

      await ImageBuildService.readDockerfile('images/base Dockerfile');
      await ImageBuildService.createDockerfile('images/Dockerfile', 'FROM alpine');
      await ImageBuildService.saveDockerfile('images/Dockerfile', 'FROM python:3.12');

      expect(getRequest).toHaveBeenCalledWith('elyra/images/dockerfiles?path=images%2Fbase%20Dockerfile');
      expect(postRequest).toHaveBeenCalledWith(
        'elyra/images/dockerfiles',
        JSON.stringify({ path: 'images/Dockerfile', content: 'FROM alpine' })
      );
      expect(putRequest).toHaveBeenCalledWith(
        'elyra/images/dockerfiles',
        JSON.stringify({ path: 'images/Dockerfile', content: 'FROM python:3.12' })
      );
    });

    it('starts, controls, and registers image builds using encoded build identifiers', async () => {
      const getRequest = jest.spyOn(RequestHandler, 'makeGetRequest').mockResolvedValue({ logs: [] } as never);
      const postRequest = jest.spyOn(RequestHandler, 'makePostRequest').mockResolvedValue(undefined);

      await ImageBuildService.startBuild({
        dockerfile_path: 'Dockerfile',
        image_reference: 'registry.example.com/team/image:latest',
        credential_source: 'user',
        credential_id: 'credential-1'
      });
      await ImageBuildService.getLogs('build/one');
      await ImageBuildService.stopBuild('build/one');
      await ImageBuildService.pushBuild('build/one');
      await ImageBuildService.registerRuntimeImage('build/one', 'Image', 'Ready to use');

      expect(getRequest).toHaveBeenCalledWith('elyra/images/builds/build%2Fone/logs');
      expect(postRequest).toHaveBeenNthCalledWith(
        1,
        'elyra/images/builds',
        JSON.stringify({
          dockerfile_path: 'Dockerfile',
          image_reference: 'registry.example.com/team/image:latest',
          credential_source: 'user',
          credential_id: 'credential-1'
        })
      );
      expect(postRequest).toHaveBeenNthCalledWith(2, 'elyra/images/builds/build%2Fone/stop', '{}');
      expect(postRequest).toHaveBeenNthCalledWith(3, 'elyra/images/builds/build%2Fone/push', '{}');
      expect(postRequest).toHaveBeenNthCalledWith(
        4,
        'elyra/images/builds/build%2Fone/runtime-image',
        JSON.stringify({ display_name: 'Image', description: 'Ready to use' })
      );
    });

    it('manages personal credentials without adding tokens to summaries', async () => {
      const getRequest = jest
        .spyOn(RequestHandler, 'makeGetRequest')
        .mockResolvedValue({ credentials: [{ id: 'admin', source: 'admin' }] } as never);
      const postRequest = jest.spyOn(RequestHandler, 'makePostRequest').mockResolvedValue(undefined);
      const putRequest = jest.spyOn(RequestHandler, 'makePutRequest').mockResolvedValue(undefined);
      const deleteRequest = jest.spyOn(RequestHandler, 'makeDeleteRequest').mockResolvedValue(undefined);
      const credential = {
        display_name: 'Private registry',
        registry_url: 'registry.example.com',
        username: 'alice',
        token: 'secret'
      };

      await expect(ImageBuildService.listCredentials()).resolves.toEqual([{ id: 'admin', source: 'admin' }]);
      await ImageBuildService.createCredential(credential);
      await ImageBuildService.updateCredential('credential/1', { ...credential, token: undefined });
      await ImageBuildService.deleteCredential('credential/1');

      expect(getRequest).toHaveBeenCalledWith('elyra/images/credentials');
      expect(postRequest).toHaveBeenCalledWith('elyra/images/credentials', JSON.stringify(credential));
      expect(putRequest).toHaveBeenCalledWith(
        'elyra/images/credentials/credential%2F1',
        JSON.stringify({ ...credential, token: undefined })
      );
      expect(deleteRequest).toHaveBeenCalledWith('elyra/images/credentials/credential%2F1');
    });
  });
});
