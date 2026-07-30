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

import { IErrorResponse, RequestErrors } from '@elyra/ui-components';
import * as React from 'react';

import {
  IImageBuild,
  IImageBuildLogEntry,
  IRegistryCredentialSummary,
  ImageBuildService
} from './ImageBuildService';

const isActive = (build?: IImageBuild): boolean =>
  build?.status === 'queued' || build?.status === 'running' || build?.status === 'pushing';

/** Dockerfile editor and build controls used by the Runtime Images workspace. */
export const DockerfileImageBuilderWidget: React.FC = () => {
  const [dockerfilePath, setDockerfilePath] = React.useState('Dockerfile');
  const [content, setContent] = React.useState('');
  const [imageReference, setImageReference] = React.useState('');
  const [credentials, setCredentials] = React.useState<IRegistryCredentialSummary[]>([]);
  const [credentialId, setCredentialId] = React.useState('admin');
  const [builds, setBuilds] = React.useState<IImageBuild[]>([]);
  const [selectedBuild, setSelectedBuild] = React.useState<IImageBuild>();
  const [logs, setLogs] = React.useState<IImageBuildLogEntry[]>([]);
  const [runtimeImageName, setRuntimeImageName] = React.useState('');
  const [runtimeImageDescription, setRuntimeImageDescription] = React.useState('');
  const [credentialName, setCredentialName] = React.useState('');
  const [registryUrl, setRegistryUrl] = React.useState('');
  const [registryUsername, setRegistryUsername] = React.useState('');
  const [registryToken, setRegistryToken] = React.useState('');
  const [editingCredentialId, setEditingCredentialId] = React.useState<string>();
  const [loading, setLoading] = React.useState(false);

  const reportError = async (error: unknown): Promise<void> => {
    await RequestErrors.serverError(error as IErrorResponse);
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextBuilds, nextCredentials] = await Promise.all([
        ImageBuildService.listBuilds(),
        ImageBuildService.listCredentials()
      ]);
      setBuilds(nextBuilds);
      setCredentials(nextCredentials);
      setSelectedBuild((current) => nextBuilds.find((build) => build.id === current?.id));
    } catch (error) {
      await reportError(error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void refresh();
  }, []);

  React.useEffect(() => {
    if (!isActive(selectedBuild)) {
      return;
    }
    const interval = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(interval);
  }, [selectedBuild?.id, selectedBuild?.status]);

  const loadDockerfile = async (): Promise<void> => {
    try {
      const dockerfile = await ImageBuildService.readDockerfile(dockerfilePath);
      if (dockerfile) {
        setDockerfilePath(dockerfile.path);
        setContent(dockerfile.content);
      }
    } catch (error) {
      await reportError(error);
    }
  };

  const saveDockerfile = async (): Promise<void> => {
    try {
      const dockerfile = await ImageBuildService.saveDockerfile(dockerfilePath, content);
      if (dockerfile) {
        setDockerfilePath(dockerfile.path);
      }
    } catch (error) {
      await reportError(error);
    }
  };

  const createDockerfile = async (): Promise<void> => {
    try {
      const dockerfile = await ImageBuildService.createDockerfile(dockerfilePath, content);
      if (dockerfile) {
        setDockerfilePath(dockerfile.path);
        setContent(dockerfile.content);
      }
    } catch (error) {
      await reportError(error);
    }
  };

  const startBuild = async (): Promise<void> => {
    try {
      const credential = credentials.find((item) => item.id === credentialId);
      const build = await ImageBuildService.startBuild({
        dockerfile_path: dockerfilePath,
        image_reference: imageReference,
        credential_source: credential ? 'user' : 'admin',
        credential_id: credential?.id
      });
      if (build) {
        setSelectedBuild(build);
        setBuilds((current) => [build, ...current]);
      }
    } catch (error) {
      await reportError(error);
    }
  };

  const selectBuild = async (build: IImageBuild): Promise<void> => {
    try {
      setSelectedBuild(build);
      setLogs(await ImageBuildService.getLogs(build.id));
      setRuntimeImageName(build.image_reference);
    } catch (error) {
      await reportError(error);
    }
  };

  const stopBuild = async (): Promise<void> => {
    if (!selectedBuild) {
      return;
    }
    try {
      const build = await ImageBuildService.stopBuild(selectedBuild.id);
      if (build) {
        setSelectedBuild(build);
        await refresh();
      }
    } catch (error) {
      await reportError(error);
    }
  };

  const pushBuild = async (): Promise<void> => {
    if (!selectedBuild) {
      return;
    }
    try {
      const build = await ImageBuildService.pushBuild(selectedBuild.id);
      if (build) {
        setSelectedBuild(build);
        await refresh();
      }
    } catch (error) {
      await reportError(error);
    }
  };

  const registerRuntimeImage = async (): Promise<void> => {
    if (!selectedBuild) {
      return;
    }
    try {
      await ImageBuildService.registerRuntimeImage(
        selectedBuild.id,
        runtimeImageName,
        runtimeImageDescription
      );
    } catch (error) {
      await reportError(error);
    }
  };

  const resetCredentialForm = (): void => {
    setCredentialName('');
    setRegistryUrl('');
    setRegistryUsername('');
    setRegistryToken('');
    setEditingCredentialId(undefined);
  };

  const editCredential = (credential: IRegistryCredentialSummary): void => {
    setCredentialName(credential.display_name);
    setRegistryUrl(credential.registry_url);
    setRegistryUsername(credential.username);
    setRegistryToken('');
    setEditingCredentialId(credential.id);
  };

  const saveCredential = async (): Promise<void> => {
    try {
      const credential = {
        display_name: credentialName,
        registry_url: registryUrl,
        username: registryUsername,
        ...(registryToken ? { token: registryToken } : {})
      };
      if (editingCredentialId) {
        await ImageBuildService.updateCredential(editingCredentialId, credential);
      } else {
        await ImageBuildService.createCredential({ ...credential, token: registryToken });
      }
      resetCredentialForm();
      await refresh();
    } catch (error) {
      setRegistryToken('');
      await reportError(error);
    }
  };

  const deleteCredential = async (credential: IRegistryCredentialSummary): Promise<void> => {
    try {
      await ImageBuildService.deleteCredential(credential.id);
      if (credentialId === credential.id) {
        setCredentialId('admin');
      }
      if (editingCredentialId === credential.id) {
        resetCredentialForm();
      }
      await refresh();
    } catch (error) {
      await reportError(error);
    }
  };

  return (
    <section className="elyra-dockerfileImageBuilder">
      <header>
        <h3>Dockerfile Image Builder</h3>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
      </header>
      <label>
        Dockerfile path
        <input value={dockerfilePath} onChange={(event) => setDockerfilePath(event.target.value)} />
      </label>
      <div>
        <button type="button" onClick={() => void loadDockerfile()}>
          Open
        </button>
        <button type="button" onClick={() => void createDockerfile()}>
          Create
        </button>
        <button type="button" onClick={() => void saveDockerfile()}>
          Save
        </button>
      </div>
      <textarea
        aria-label="Dockerfile content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={14}
      />
      <label>
        Image reference
        <input value={imageReference} onChange={(event) => setImageReference(event.target.value)} />
      </label>
      <label>
        Registry credential
        <select value={credentialId} onChange={(event) => setCredentialId(event.target.value)}>
          <option value="admin">Administrator default</option>
          {credentials
            .filter((credential) => credential.source === 'user')
            .map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.display_name} ({credential.registry_url})
              </option>
            ))}
        </select>
      </label>
      <section>
        <h4>Personal registry credentials</h4>
        <label>
          Display name
          <input value={credentialName} onChange={(event) => setCredentialName(event.target.value)} />
        </label>
        <label>
          Registry URL
          <input value={registryUrl} onChange={(event) => setRegistryUrl(event.target.value)} />
        </label>
        <label>
          Username
          <input value={registryUsername} onChange={(event) => setRegistryUsername(event.target.value)} />
        </label>
        <label>
          Access token
          <input
            type="password"
            value={registryToken}
            onChange={(event) => setRegistryToken(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={!credentialName.trim() || !registryUrl.trim() || !registryUsername.trim() || (!editingCredentialId && !registryToken)}
          onClick={() => void saveCredential()}
        >
          {editingCredentialId ? 'Update credential' : 'Save credential'}
        </button>
        {editingCredentialId ? (
          <button type="button" onClick={resetCredentialForm}>
            Cancel edit
          </button>
        ) : null}
        <ul>
          {credentials
            .filter((credential) => credential.source === 'user')
            .map((credential) => (
              <li key={credential.id}>
                {credential.display_name} ({credential.registry_url})
                <button type="button" onClick={() => editCredential(credential)}>
                  Edit
                </button>
                <button type="button" onClick={() => void deleteCredential(credential)}>
                  Delete
                </button>
              </li>
            ))}
        </ul>
      </section>
      <button type="button" disabled={loading || !imageReference.trim()} onClick={() => void startBuild()}>
        Build image
      </button>
      <section>
        <h4>Build history</h4>
        {builds.length === 0 ? <p>No image builds recorded.</p> : null}
        <ul>
          {builds.map((build) => (
            <li key={build.id}>
              <button type="button" onClick={() => void selectBuild(build)}>
                {build.image_reference} - {build.status}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {selectedBuild ? (
        <section>
          <h4>Build {selectedBuild.status}</h4>
          {selectedBuild.error_summary ? <p>{selectedBuild.error_summary}</p> : null}
          {isActive(selectedBuild) ? (
            <button type="button" onClick={() => void stopBuild()}>
              Stop build
            </button>
          ) : null}
          {selectedBuild.status === 'succeeded' ? (
            <button type="button" onClick={() => void pushBuild()}>
              Push image
            </button>
          ) : null}
          {selectedBuild.status === 'pushed' ? (
            <div>
              <label>
                Runtime Image name
                <input value={runtimeImageName} onChange={(event) => setRuntimeImageName(event.target.value)} />
              </label>
              <label>
                Description
                <input
                  value={runtimeImageDescription}
                  onChange={(event) => setRuntimeImageDescription(event.target.value)}
                />
              </label>
              <button type="button" onClick={() => void registerRuntimeImage()}>
                Add Runtime Image
              </button>
            </div>
          ) : null}
          <pre>{logs.map((log) => `${log.timestamp} ${log.level} ${log.message}`).join('\n')}</pre>
        </section>
      ) : null}
    </section>
  );
};
