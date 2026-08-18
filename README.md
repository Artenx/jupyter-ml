# jupyter-ml

jupyter-ml is a set of independent, zero-fork Jupyter extensions built on top of
the upstream [`elyra`](https://github.com/elyra-ai/elyra) package.

The plugins in this repository restore the custom scheduling and image-building
capabilities previously maintained in a fork of Elyra, without modifying or
vendoring any upstream source. Each plugin depends on upstream `elyra` via the
standard Python entry-point APIs (`jupyter_server.extensions`,
`elyra.pipeline.processors`, `papermill.engine`, and the Elyra metadata service).

## Plugins

| Package | Description |
| --- | --- |
| [`jupyter-ml-scheduling`](plugins/local-scheduling/README.md) | Local pipeline scheduling and task management: cron schedules, run history, direct runs, retries, and Enterprise Gateway kernel-id tracking. |
| [`jupyter-ml-image-builder`](plugins/image-builder/README.md) | A workspace Dockerfile image builder with user-isolated builds, registry credentials, and Runtime Images metadata registration. |

See each plugin's README for features, configuration, and development details.

## Requirements

- Python 3.9+
- [Elyra](https://github.com/elyra-ai/elyra) 4.1.1 (installed from PyPI)
- JupyterLab 4.x (for the frontend extensions)

## Installation

Install the Python server extensions from this repository:

```bash
pip install ./plugins/local-scheduling
pip install ./plugins/image-builder
```

Enable the server extensions:

```bash
jupyter server extension enable --py jupyter_ml_scheduling
jupyter server extension enable --py jupyter_ml_image_builder
```

The frontend JupyterLab extensions are packaged inside each Python wheel as
prebuilt labextensions. To build them from source during development, first
install JupyterLab (provides the `jupyter labextension` command), then build
each extension:

```bash
pip install "jupyterlab>=4.4.2,<5"
cd plugins/local-scheduling
npm install
npm run build
jupyter labextension develop . --overwrite
```

Each plugin's frontend build (`npm run build`) produces `lib/` via `tsc` and a
prebuilt labextension under the plugin's Python package directory (configured
by `jupyterlab.outputDir`), which is then included in the Python wheel.

## Development

Backend tests (each plugin):

```bash
cd plugins/local-scheduling && python3 -m pytest
cd plugins/image-builder && python3 -m pytest
```

Frontend tests and type checking (each plugin):

```bash
cd plugins/local-scheduling
npm install
./node_modules/.bin/jest
./node_modules/.bin/tsc --noEmit
```

## Zero-fork verification

The plugins are verified against the upstream `elyra` wheel (no fork source on
`PYTHONPATH`). To reproduce:

```bash
python3 -m pip install --target /tmp/upstream-elyra elyra==4.1.1 --no-deps
cd plugins/local-scheduling && PYTHONPATH=/tmp/upstream-elyra python3 -m pytest
cd plugins/image-builder && PYTHONPATH=/tmp/upstream-elyra python3 -m pytest
```

## License

[Apache License 2.0](LICENSE)
