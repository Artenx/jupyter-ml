#
# Copyright 2018-2026 Elyra Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Server-side configuration for Dockerfile image builds."""

from traitlets import Unicode
from traitlets.config import LoggingConfigurable


class RegistrySettings(LoggingConfigurable):
    """Configurable administrator registry credentials and encryption key."""

    admin_registry_url = Unicode("", help="Registry URL used by the administrator-provided image push credential.").tag(
        config=True
    )
    admin_username = Unicode("", help="Username used by the administrator-provided registry credential.").tag(
        config=True
    )
    admin_token = Unicode("", help="Access token used by the administrator-provided registry credential.").tag(
        config=True
    )
    credential_master_key = Unicode(
        "", help="URL-safe base64 Fernet key used to encrypt user registry tokens at rest."
    ).tag(config=True)

    def has_admin_credential(self) -> bool:
        """Return whether all administrator registry credential fields are configured."""
        return bool(self.admin_registry_url and self.admin_username and self.admin_token)
