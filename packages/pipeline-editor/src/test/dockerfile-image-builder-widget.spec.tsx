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

import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { DockerfileImageBuilderWidget } from '../DockerfileImageBuilderWidget';
import { ImageBuildService } from '../ImageBuildService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setInput = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const setSelect = async (select: HTMLSelectElement, value: string): Promise<void> => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const getInput = (container: HTMLElement, labelText: string): HTMLInputElement => {
  const labels = Array.from(container.querySelectorAll('label'));
  const label = labels.find((item) => item.textContent?.trim().startsWith(labelText));
  const input = label?.querySelector('input');
  if (!input) {
    throw new Error(`Input with label "${labelText}" was not found.`);
  }
  return input;
};

describe('@elyra/pipeline-editor', () => {
  describe('DockerfileImageBuilderWidget', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('uses the selected personal credential to start a build and clears saved tokens', async () => {
      jest.spyOn(ImageBuildService, 'listBuilds').mockResolvedValue([]);
      jest.spyOn(ImageBuildService, 'listCredentials').mockResolvedValue([
        {
          id: 'admin',
          display_name: 'Administrator default',
          registry_url: 'registry.example.com',
          username: 'admin',
          source: 'admin'
        },
        {
          id: 'private',
          display_name: 'Private registry',
          registry_url: 'private.example.com',
          username: 'alice',
          source: 'user'
        }
      ]);
      const startBuild = jest.spyOn(ImageBuildService, 'startBuild').mockResolvedValue(undefined);
      const createCredential = jest.spyOn(ImageBuildService, 'createCredential').mockResolvedValue(undefined);
      const container = document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(DockerfileImageBuilderWidget));
      });
      await setInput(getInput(container, 'Image reference'), 'private.example.com/team/image:latest');
      await setInput(getInput(container, 'Display name'), 'Another registry');
      await setInput(getInput(container, 'Registry URL'), 'another.example.com');
      await setInput(getInput(container, 'Username'), 'alice');
      await setInput(getInput(container, 'Access token'), 'private-token');
      const selects = container.querySelectorAll('select');
      await setSelect(selects[0], 'private');
      const buttons = Array.from(container.querySelectorAll('button'));
      const saveButton = buttons.find((button) => button.textContent === 'Save credential');
      await act(async () => {
        saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(createCredential).toHaveBeenCalledWith({
        display_name: 'Another registry',
        registry_url: 'another.example.com',
        username: 'alice',
        token: 'private-token'
      });
      expect(getInput(container, 'Access token').value).toBe('');

      const buildButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Build image'
      );
      await act(async () => {
        buildButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(startBuild).toHaveBeenCalledWith({
        dockerfile_path: 'Dockerfile',
        image_reference: 'private.example.com/team/image:latest',
        credential_source: 'user',
        credential_id: 'private'
      });
      await act(async () => {
        root.unmount();
      });
    });

    it('shows pushed build logs and registers the image as a Runtime Image', async () => {
      const build = {
        id: 'build-1',
        dockerfile_path: 'Dockerfile',
        context_path: '.',
        image_reference: 'registry.example.com/team/image:latest',
        status: 'pushed' as const,
        credential_source: 'admin' as const,
        created_at: '2026-07-30T12:00:00'
      };
      jest.spyOn(ImageBuildService, 'listBuilds').mockResolvedValue([build]);
      jest.spyOn(ImageBuildService, 'listCredentials').mockResolvedValue([]);
      jest.spyOn(ImageBuildService, 'getLogs').mockResolvedValue([
        { timestamp: '2026-07-30T12:01:00', level: 'INFO', message: 'Image pushed' }
      ]);
      const registerRuntimeImage = jest.spyOn(ImageBuildService, 'registerRuntimeImage').mockResolvedValue({});
      const container = document.createElement('div');
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(DockerfileImageBuilderWidget));
      });
      expect(container.querySelector('.elyra-imageBuilder-workspace')).not.toBeNull();
      expect(container.querySelector('.elyra-imageBuilder-authoring')).not.toBeNull();
      expect(container.querySelector('.elyra-imageBuilder-buildForm')).not.toBeNull();
      const buildButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('registry.example.com/team/image:latest')
      );
      await act(async () => {
        buildButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      expect(container.textContent).toContain('Image pushed');
      expect(container.querySelector('.elyra-imageBuilder-historyItem.is-selected')).not.toBeNull();
      expect(container.querySelector('.elyra-imageBuilder-status.is-pushed')).not.toBeNull();
      const registerButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Add Runtime Image'
      );
      await act(async () => {
        registerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(registerRuntimeImage).toHaveBeenCalledWith(
        'build-1',
        'registry.example.com/team/image:latest',
        ''
      );
      await act(async () => {
        root.unmount();
      });
    });
  });
});
