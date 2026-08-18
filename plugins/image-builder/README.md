# jupyter-ml-image-builder

Dockerfile image builder for Elyra/JupyterLab.

This package is a zero-fork Jupyter Server extension that adds a workspace
Dockerfile image builder on top of the upstream `elyra` package. It provides:

- Workspace Dockerfile editing and validation.
- Local Docker CLI builds with user-isolated task history and logs.
- Administrator-provided or per-user registry credentials for image pushes.
- Runtime Images metadata registration for successfully pushed images.

## Installation

```bash
pip install jupyter-ml-image-builder
```

Enable the server extension:

```bash
jupyter server extension enable --py jupyter_ml_image_builder
```

## Configuration

Administrator registry credentials and build authorization are configured via
`jupyter_server_config.py`:

```python
c.RegistrySettings.admin_registry_url = "registry.example.com"
c.RegistrySettings.admin_username = "admin"
c.RegistrySettings.admin_token = "<access-token>"
c.RegistrySettings.credential_master_key = "<url-safe-base64-fernet-key>"
c.RegistrySettings.allowed_build_users = ["*"]
```

Generate a master key with:

```python
from cryptography.fernet import Fernet
print(Fernet.generate_key().decode("utf-8"))
```

## Development

```bash
pip install -e ".[test]"
pytest
```
