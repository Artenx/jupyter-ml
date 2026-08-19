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

import { IErrorResponse, RequestErrors } from './requestErrors';
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
  onOpenDockerfile?: (path: string) => void;
}

/** Dockerfile editor and build controls used by the Runtime Images workspace. */
export const DockerfileImageBuilderWidget: React.FC<IDockerfileImageBuilderWidgetProps> = ({
  onRuntimeImageRegistered,
  onOpenDockerfile
}) => {
  const [dockerfilePath, setDockerfilePath] = React.useState('Dockerfile');
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
  const [showCredentials, setShowCredentials] = React.useState(false);
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
    <section className="jupyter-ml-dockerfileImageBuilder">
      {/* Dockerfile Section */}
      <div className="jupyter-ml-imageBuilder-section">
        <div className="jupyter-ml-imageBuilder-sectionHeader">
          <span>Dockerfile</span>
          <button
            type="button"
            className="jp-mod-styled jp-mod-accept"
            onClick={() => onOpenDockerfile?.(dockerfilePath)}
            title="Open in editor"
          >
            Open
          </button>
        </div>
        <input
          className="jupyter-ml-imageBuilder-pathInput"
          value={dockerfilePath}
          onChange={(event) => setDockerfilePath(event.target.value)}
          placeholder="Dockerfile path"
        />
      </div>

      {/* Build Configuration */}
      <div className="jupyter-ml-imageBuilder-section">
        <div className="jupyter-ml-imageBuilder-sectionHeader">
          <span>Build</span>
        </div>
        <input
          className="jupyter-ml-imageBuilder-input"
          value={imageReference}
          onChange={(event) => setImageReference(event.target.value)}
          placeholder="Image reference (e.g., myimage:latest)"
        />
        <select
          className="jupyter-ml-imageBuilder-select"
          value={credentialId}
          onChange={(event) => setCredentialId(event.target.value)}
        >
          <option value="admin">Default credentials</option>
          {credentials
            .filter((credential) => credential.source === 'user')
            .map((credential) => (
              <option key={credential.id} value={credential.id}>
                {credential.display_name}
              </option>
            ))}
        </select>
        <button
          type="button"
          className="jupyter-ml-imageBuilder-buildButton"
          disabled={loading || startingBuild || !imageReference.trim() || !dockerfilePath.trim()}
          onClick={() => void startBuild()}
        >
          {startingBuild ? 'Building...' : 'Build Image'}
        </button>
      </div>

      {/* Build History */}
      <div className="jupyter-ml-imageBuilder-section">
        <div className="jupyter-ml-imageBuilder-sectionHeader">
          <span>History</span>
          <button
            type="button"
            className="jp-mod-styled"
            onClick={() => void refresh()}
            title="Refresh"
          >
            ↻
          </button>
        </div>
        {builds.length === 0 ? (
          <p className="jupyter-ml-imageBuilder-empty">No builds yet</p>
        ) : (
          <ul className="jupyter-ml-imageBuilder-buildList">
            {builds.map((build) => (
              <li key={build.id}>
                <button
                  type="button"
                  className={`jupyter-ml-imageBuilder-buildItem ${
                    selectedBuild?.id === build.id ? 'is-selected' : ''
                  }`}
                  onClick={() => void selectBuild(build)}
                >
                  <span className="jupyter-ml-imageBuilder-buildRef">{build.image_reference}</span>
                  <span className={`jupyter-ml-imageBuilder-status is-${build.status}`}>
                    {build.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Build Details */}
      {selectedBuild && (
        <div className="jupyter-ml-imageBuilder-section">
          <div className="jupyter-ml-imageBuilder-sectionHeader">
            <span>Details</span>
          </div>
          {selectedBuild.error_summary && (
            <p className="jupyter-ml-imageBuilder-error">{selectedBuild.error_summary}</p>
          )}
          <div className="jupyter-ml-imageBuilder-buttonRow">
            {isActive(selectedBuild) && (
              <button
                type="button"
                disabled={Boolean(pendingAction)}
                onClick={() => void stopBuild()}
              >
                {pendingAction === 'stop' ? 'Stopping...' : 'Stop'}
              </button>
            )}
            {selectedBuild.status === 'succeeded' && (
              <button
                type="button"
                disabled={Boolean(pendingAction)}
                onClick={() => void pushBuild()}
              >
                {pendingAction === 'push' ? 'Pushing...' : 'Push'}
              </button>
            )}
          </div>
          {selectedBuild.status === 'pushed' && (
            <div className="jupyter-ml-imageBuilder-runtimeForm">
              <input
                className="jupyter-ml-imageBuilder-input"
                value={runtimeImageName}
                onChange={(event) => setRuntimeImageName(event.target.value)}
                placeholder="Runtime image name"
              />
              <input
                className="jupyter-ml-imageBuilder-input"
                value={runtimeImageDescription}
                onChange={(event) => setRuntimeImageDescription(event.target.value)}
                placeholder="Description (optional)"
              />
              <button
                type="button"
                disabled={Boolean(pendingAction) || !runtimeImageName.trim()}
                onClick={() => void registerRuntimeImage()}
              >
                {pendingAction === 'register' ? 'Adding...' : 'Add as Runtime'}
              </button>
            </div>
          )}
          {logs.length > 0 && (
            <pre className="jupyter-ml-imageBuilder-logs">
              {logs.map((log) => `${log.timestamp} ${log.level} ${log.message}`).join('\n')}
            </pre>
          )}
        </div>
      )}

      {/* Credentials (Collapsible) */}
      <div className="jupyter-ml-imageBuilder-section">
        <div
          className="jupyter-ml-imageBuilder-sectionHeader"
          onClick={() => setShowCredentials(!showCredentials)}
          style={{ cursor: 'pointer' }}
        >
          <span>Credentials {showCredentials ? '▼' : '▶'}</span>
        </div>
        {showCredentials && (
          <>
            <input
              className="jupyter-ml-imageBuilder-input"
              value={credentialName}
              onChange={(event) => setCredentialName(event.target.value)}
              placeholder="Display name"
            />
            <input
              className="jupyter-ml-imageBuilder-input"
              value={registryUrl}
              onChange={(event) => setRegistryUrl(event.target.value)}
              placeholder="Registry URL"
            />
            <input
              className="jupyter-ml-imageBuilder-input"
              value={registryUsername}
              onChange={(event) => setRegistryUsername(event.target.value)}
              placeholder="Username"
            />
            <input
              className="jupyter-ml-imageBuilder-input"
              type="password"
              value={registryToken}
              onChange={(event) => setRegistryToken(event.target.value)}
              placeholder="Token"
            />
            <div className="jupyter-ml-imageBuilder-buttonRow">
              <button
                type="button"
                disabled={
                  !credentialName.trim() ||
                  !registryUrl.trim() ||
                  !registryUsername.trim() ||
                  (!editingCredentialId && !registryToken)
                }
                onClick={() => void saveCredential()}
              >
                {editingCredentialId ? 'Update' : 'Save'}
              </button>
              {editingCredentialId && (
                <button type="button" onClick={resetCredentialForm}>
                  Cancel
                </button>
              )}
            </div>
            {credentials.filter((c) => c.source === 'user').length > 0 && (
              <ul className="jupyter-ml-imageBuilder-credentialList">
                {credentials
                  .filter((c) => c.source === 'user')
                  .map((credential) => (
                    <li key={credential.id}>
                      <span>{credential.display_name}</span>
                      <span>
                        <button type="button" onClick={() => editCredential(credential)}>
                          Edit
                        </button>
                        <button type="button" onClick={() => void deleteCredential(credential)}>
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
};
