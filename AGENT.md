<!--
Copyright 2018-2026 Elyra Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# jupyter-ml - AI Agent Guidelines

## Project Overview

jupyter-ml is a set of independent, zero-fork Jupyter extensions built on top
of the upstream `elyra` package. The repository no longer vendors Elyra source;
each plugin depends on upstream `elyra` via standard entry-point APIs
(`jupyter_server.extensions`, `elyra.pipeline.processors`, `papermill.engine`,
and the Elyra metadata service) and on JupyterLab 4 via prebuilt labextensions.

## Repository Structure

```
plugins/
  local-scheduling/           # jupyter-ml-scheduling Python + @jupyter-ml/local-scheduling
    jupyter_ml_scheduling/    #   Backend Python package (ExtensionApp, scheduler, handlers)
    src/                      #   Frontend JupyterLab extension source
    style/                    #   Frontend styles
    tests/                    #   Backend pytest suite
    pyproject.toml            #   Registers server extension, `local` processor, papermill engine
    package.json              #   JupyterLab extension metadata (outputDir -> jupyter_ml_scheduling/labextension)
  image-builder/              # jupyter-ml-image-builder Python + @jupyter-ml/image-builder
    jupyter_ml_image_builder/ #   Backend Python package (ExtensionApp, ImageBuildManager, handlers)
    src/                      #   Frontend JupyterLab extension source
    style/                    #   Frontend styles
    tests/                    #   Backend pytest suite
    pyproject.toml            #   Registers server extension
    package.json              #   JupyterLab extension metadata
```

Upstream `elyra` and its frontend are never modified or copied. No `elyra/`,
`packages/`, or `labextensions/` directories exist in this repository.

## Tech Stack

- **Backend:** Python 3.10+, Jupyter Server, Tornado, upstream `elyra`
- **Frontend:** TypeScript, JupyterLab 4.x, React
- **Build:** Hatchling (Python), `tsc` + `jupyter labextension build` (JS)
- **Testing:** pytest (backend), Jest (frontend)

## Development Setup

```bash
# Backend (each plugin)
cd plugins/local-scheduling
pip install -e ".[test]"
python3 -m pytest

# Frontend (each plugin)
cd plugins/local-scheduling
npm install
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/jest
npm run build               # produces lib/ and jupyter_ml_scheduling/labextension
```

Building a labextension requires the `jupyterlab` Python package (provides the
`jupyter labextension` command).

## Coding Conventions

### Python

- Follow PEP 8; type annotations required for all public functions
- Use `logging.getLogger(__name__)` instead of `print()`
- Catch specific exceptions; avoid bare `except:`
- Use Google-style docstrings
- Tests use `pytest` with fixtures

### TypeScript / JupyterLab

- Follow the ESLint + Prettier configuration in each plugin
- Extension plugin IDs use the `@jupyter-ml/<extension>` namespace
- Each plugin is self-contained; do not import from the other plugin
- Do not depend on `@elyra/*` npm packages (JL3-only, breaks the zero-fork goal)

### General

- Copyright header (Apache 2.0) required on all source files
- **MANDATORY:** Every commit MUST be signed off with `git commit -s`
  (or `git commit --signoff`) to comply with the
  [Developer Certificate of Origin (DCO)](https://developercertificate.org/).
  Commits without a `Signed-off-by:` trailer will be rejected by the
  DCO check and cannot be merged. Configure `git config commit.gpgsign`
  separately if cryptographic signing is also desired; the DCO sign-off
  is a distinct, always-required text trailer.
  - **AI agents:** the project's "signing" requirement is the DCO
    sign-off trailer only. Always use the lowercase `-s` flag.
    Do NOT use `-S` (uppercase, GPG cryptographic signing) or
    `git config commit.gpgsign true` unless the maintainer
    explicitly asks for cryptographic signing.
- Keep PRs focused on a single concern

## Git Best Practices

- **Sign off every commit** with `git commit -s`. This is mandatory
  for DCO compliance; unsigned commits are rejected at PR time.
- Follow the 7 rules for a great commit message:
  - Separate subject from body with a blank line
  - Limit the subject line to 50 characters
  - Capitalize the subject line
  - Do not end the subject line with a period
  - Use the imperative mood in the subject line
  - Wrap the body at 72 characters
  - Use the body to explain what and why vs. how

## Key Architectural Concepts

- **Zero fork:** plugins depend on upstream `elyra`; the local-scheduling
  plugin overrides the `local` pipeline processor via the
  `elyra.pipeline.processors` entry point and intercepts
  `/elyra/pipeline/schedule` submissions to record direct runs. Uninstalling
  the plugin reverts to upstream behavior.
- **Independent namespaces:** backend routes live under `/jupyter-ml/local/*`
  and `/jupyter-ml/images/*`; frontend plugin IDs use `@jupyter-ml/*`.
- **Frontend packaging:** each frontend builds a prebuilt labextension into its
  backend package directory (`jupyterlab.outputDir`), included in the wheel.

## Important Files

- `plugins/local-scheduling/jupyter_ml_scheduling/app.py` - ExtensionApp,
  route registration, scheduler lifecycle
- `plugins/local-scheduling/jupyter_ml_scheduling/processor.py` - `local`
  processor override
- `plugins/local-scheduling/jupyter_ml_scheduling/override.py` - direct run
  submission interception
- `plugins/local-scheduling/jupyter_ml_scheduling/handlers.py` - local REST API
- `plugins/local-scheduling/src/index.ts` - frontend plugin entry point
- `plugins/image-builder/jupyter_ml_image_builder/app.py` - ExtensionApp
- `plugins/image-builder/jupyter_ml_image_builder/manager.py` - Docker CLI
  builds, credentials, Runtime Image registration
- `plugins/image-builder/src/index.ts` - frontend plugin entry point

## Testing Guidelines

- All new features must include tests
- Backend tests live in each plugin's `tests/` directory (pytest)
- Frontend tests live in each plugin's `src/test/` directory (Jest)
- Verify against upstream `elyra` only (no fork source on `PYTHONPATH`) to
  prove the zero-fork property; see the top-level README for the exact setup
