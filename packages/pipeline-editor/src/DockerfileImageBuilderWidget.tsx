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

export interface IDockerfileImageBuilderWidgetProps {
  onRuntimeImageRegistered?: () => void;
}

/** Dockerfile editor and build controls used by the Runtime Images workspace. */
export const DockerfileImageBuilderWidget: React.FC<IDockerfileImageBuilderWidgetProps> = ({
  onRuntimeImageRegistered
}) => {
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
  const [startingBuild, setStartingBuild] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<string>();
  const refreshRequest = React.useRef(0);
  const logRequest = React.useRef(0);

  const reportError = async (error: unknown): Promise<void> => {
    await RequestErrors.serverError(error as IErrorResponse);
  };

  const refresh = async (): Promise<void> => {
    const request = ++refreshRequest.current;
    setLoading(true);
    try {
      const [nextBuilds, nextCredentials] = await Promise.all([
        ImageBuildService.listBuilds(),
        ImageBuildService.listCredentials()
      ]);
      if (request !== refreshRequest.current) {
        return;
      }
      setBuilds(nextBuilds);
      setCredentials(nextCredentials);
      setSelectedBuild((current) => nextBuilds.find((build) => build.id === current?.id));
    } catch (error) {
      await reportError(error);
    } finally {
      if (request === refreshRequest.current) {
        setLoading(false);
      }
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
    if (startingBuild) {
      return;
    }
    setStartingBuild(true);
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
    } finally {
      setStartingBuild(false);
    }
  };

  const selectBuild = async (build: IImageBuild): Promise<void> => {
    const request = ++logRequest.current;
    try {
      setSelectedBuild(build);
      setLogs([]);
      setRuntimeImageName(build.image_reference);
      const nextLogs = await ImageBuildService.getLogs(build.id);
      if (request === logRequest.current) {
        setLogs(nextLogs);
      }
    } catch (error) {
      await reportError(error);
    }
  };

  const stopBuild = async (): Promise<void> => {
    if (!selectedBuild || pendingAction) {
      return;
    }
    setPendingAction('stop');
    try {
      const build = await ImageBuildService.stopBuild(selectedBuild.id);
      if (build) {
        setSelectedBuild(build);
        await refresh();
      }
    } catch (error) {
      await reportError(error);
    } finally {
      setPendingAction(undefined);
    }
  };

  const pushBuild = async (): Promise<void> => {
    if (!selectedBuild || pendingAction) {
      return;
    }
    setPendingAction('push');
    try {
      const build = await ImageBuildService.pushBuild(selectedBuild.id);
      if (build) {
        setSelectedBuild(build);
        await refresh();
      }
    } catch (error) {
      await reportError(error);
    } finally {
      setPendingAction(undefined);
    }
  };

  const registerRuntimeImage = async (): Promise<void> => {
    if (!selectedBuild || pendingAction) {
      return;
    }
    setPendingAction('register');
    try {
      await ImageBuildService.registerRuntimeImage(
        selectedBuild.id,
        runtimeImageName,
        runtimeImageDescription
      );
      onRuntimeImageRegistered?.();
    } catch (error) {
      await reportError(error);
    } finally {
      setPendingAction(undefined);
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
      <header className="elyra-imageBuilder-header">
        <div>
          <p className="elyra-imageBuilder-eyebrow">Runtime image workspace</p>
          <h3>Dockerfile Image Builder</h3>
          <p className="elyra-imageBuilder-subtitle">Author a Dockerfile, build locally, then publish it as a runtime.</p>
        </div>
        <button className="elyra-imageBuilder-refresh" type="button" onClick={() => void refresh()}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>
      <div className="elyra-imageBuilder-workspace">
        <aside className="elyra-imageBuilder-rail">
          <section className="elyra-imageBuilder-card elyra-imageBuilder-buildForm">
            <div className="elyra-imageBuilder-sectionHeading">
              <span className="elyra-imageBuilder-step">02</span>
              <div>
                <h4>Build and publish</h4>
                <p>Choose a registry identity for this image.</p>
              </div>
            </div>
            <label>
              Image reference
              <input value={imageReference} onChange={(event) => setImageReference(event.target.value)} placeholder="registry.example.com/team/image:tag" />
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
            <button className="elyra-imageBuilder-primaryAction" type="button" disabled={loading || startingBuild || !imageReference.trim()} onClick={() => void startBuild()}>
              {startingBuild ? 'Starting build...' : 'Build image'}
            </button>
          </section>
          <section className="elyra-imageBuilder-card elyra-imageBuilder-credentials">
            <div className="elyra-imageBuilder-sectionHeading">
              <span className="elyra-imageBuilder-step">03</span>
              <div>
                <h4>Personal registry credentials</h4>
                <p>Credentials remain private to your Jupyter account.</p>
              </div>
            </div>
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
              <input type="password" value={registryToken} onChange={(event) => setRegistryToken(event.target.value)} />
            </label>
            <div className="elyra-imageBuilder-buttonRow">
              <button
                type="button"
                disabled={!credentialName.trim() || !registryUrl.trim() || !registryUsername.trim() || (!editingCredentialId && !registryToken)}
                onClick={() => void saveCredential()}
              >
                {editingCredentialId ? 'Update credential' : 'Save credential'}
              </button>
              {editingCredentialId ? <button type="button" onClick={resetCredentialForm}>Cancel edit</button> : null}
            </div>
            <ul className="elyra-imageBuilder-credentialList">
              {credentials
                .filter((credential) => credential.source === 'user')
                .map((credential) => (
                  <li key={credential.id}>
                    <span><strong>{credential.display_name}</strong><small>{credential.registry_url}</small></span>
                    <span>
                      <button type="button" onClick={() => editCredential(credential)}>Edit</button>
                      <button type="button" onClick={() => void deleteCredential(credential)}>Delete</button>
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        </aside>
        <section className="elyra-imageBuilder-card elyra-imageBuilder-authoring">
          <div className="elyra-imageBuilder-sectionHeading">
            <span className="elyra-imageBuilder-step">01</span>
            <div>
              <h4>Author Dockerfile</h4>
              <p>Keep the build definition with the pipeline workspace.</p>
            </div>
          </div>
          <label>
            Dockerfile path
            <input value={dockerfilePath} onChange={(event) => setDockerfilePath(event.target.value)} />
          </label>
          <div className="elyra-imageBuilder-buttonRow">
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
            spellCheck={false}
          />
        </section>
      </div>
      <section className="elyra-imageBuilder-card elyra-imageBuilder-history">
        <div className="elyra-imageBuilder-sectionHeading">
          <span className="elyra-imageBuilder-step">04</span>
          <div>
            <h4>Build history</h4>
            <p>Inspect progress, delivery state, and build output.</p>
          </div>
        </div>
        {builds.length === 0 ? <p className="elyra-imageBuilder-empty">No image builds recorded.</p> : null}
        <ul>
          {builds.map((build) => (
            <li key={build.id}>
              <button
                className={selectedBuild?.id === build.id ? 'elyra-imageBuilder-historyItem is-selected' : 'elyra-imageBuilder-historyItem'}
                type="button"
                aria-pressed={selectedBuild?.id === build.id}
                onClick={() => void selectBuild(build)}
              >
                <span>{build.image_reference}</span>
                <span className={`elyra-imageBuilder-status is-${build.status}`}>{build.status}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {selectedBuild ? (
        <section className="elyra-imageBuilder-card elyra-imageBuilder-detail">
          <div className="elyra-imageBuilder-detailHeading">
            <div>
              <p className="elyra-imageBuilder-eyebrow">Selected build</p>
              <h4>{selectedBuild.image_reference}</h4>
            </div>
            <span className={`elyra-imageBuilder-status is-${selectedBuild.status}`}>{selectedBuild.status}</span>
          </div>
          {selectedBuild.error_summary ? <p className="elyra-imageBuilder-error">{selectedBuild.error_summary}</p> : null}
          <div className="elyra-imageBuilder-buttonRow">
            {isActive(selectedBuild) ? <button type="button" disabled={Boolean(pendingAction)} onClick={() => void stopBuild()}>{pendingAction === 'stop' ? 'Stopping build...' : 'Stop build'}</button> : null}
            {selectedBuild.status === 'succeeded' ? <button className="elyra-imageBuilder-primaryAction" type="button" disabled={Boolean(pendingAction)} onClick={() => void pushBuild()}>{pendingAction === 'push' ? 'Pushing image...' : 'Push image'}</button> : null}
          </div>
          {selectedBuild.status === 'pushed' ? (
            <div className="elyra-imageBuilder-runtimeForm">
              <h5>Add to Runtime Images</h5>
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
              <button type="button" disabled={Boolean(pendingAction)} onClick={() => void registerRuntimeImage()}>
                {pendingAction === 'register' ? 'Adding Runtime Image...' : 'Add Runtime Image'}
              </button>
            </div>
          ) : null}
          <pre aria-label="Build logs">{logs.map((log) => `${log.timestamp} ${log.level} ${log.message}`).join('\n')}</pre>
        </section>
      ) : null}
    </section>
  );
};
