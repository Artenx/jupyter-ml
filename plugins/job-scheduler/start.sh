#!/usr/bin/env bash
# Idempotent startup for the jupyter-ml job-scheduler dev environment.
#
# On every boot it (1) restores the Jupyter config, (2) ensures the Python
# package is installed, (3) rebuilds and (re)installs the prebuilt
# labextension, then launches JupyterLab. This makes the environment
# resilient to resets that wipe /root or /usr/local, since the source,
# config, and build assets live in the persisted /workspace tree.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_SRC="$SCRIPT_DIR/jupyter_lab_config.py"
CONFIG_DST="/root/.jupyter/jupyter_lab_config.py"

# 1. Restore Jupyter config (idempotent copy).
mkdir -p "$(dirname "$CONFIG_DST")"
cp -f "$CONFIG_SRC" "$CONFIG_DST"

# 2. Ensure the Python package is installed (editable; no network deps).
pip install -e "$SCRIPT_DIR" --no-deps --no-build-isolation >/dev/null 2>&1 || true

# 3. Build the frontend and (re)install the prebuilt labextension.
cd "$SCRIPT_DIR"
jlpm build
jupyter labextension install . --no-build

# 4. Launch JupyterLab.
cd /workspace
exec jupyter-lab --config="$CONFIG_DST" --allow-root --no-browser
