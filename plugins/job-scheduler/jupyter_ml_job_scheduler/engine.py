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
"""Papermill engine that reports remote Enterprise Gateway kernel identifiers."""

from papermill.clientwrap import PapermillNotebookClient
from papermill.log import logger
from papermill.utils import merge_kwargs
from papermill.utils import remove_args

from elyra.pipeline.elyra_engine import ElyraEngine


class JupyterMLNotebookClient(PapermillNotebookClient):
    """Papermill client that reports remote Enterprise Gateway kernel identifiers."""

    def __init__(self, *args, kernel_id_observer=None, **kwargs):
        self._kernel_id_observer = kernel_id_observer
        super().__init__(*args, **kwargs)

    async def async_start_new_kernel(self, **kwargs):
        await super().async_start_new_kernel(**kwargs)
        kernel_id = getattr(self.km, "kernel_id", None)
        if kernel_id and self._kernel_id_observer:
            self._kernel_id_observer(kernel_id)


class JupyterMLEngine(ElyraEngine):
    """Papermill engine extending Elyra's engine with a remote kernel id observer."""

    @classmethod
    def execute_managed_notebook(
        cls,
        nb_man,
        kernel_name,
        log_output=False,
        stdout_file=None,
        stderr_file=None,
        start_timeout=60,
        execution_timeout=None,
        **kwargs,
    ):
        kernel_id_observer = kwargs.pop("kernel_id_observer", None)
        safe_kwargs = remove_args(["timeout", "startup_timeout", "kernel_env", "kernel_cwd", "input_path"], **kwargs)

        final_kwargs = merge_kwargs(
            safe_kwargs,
            timeout=execution_timeout or kwargs.get("timeout"),
            startup_timeout=start_timeout,
            kernel_name=kernel_name,
            log=logger,
            log_output=log_output,
            stdout_file=stdout_file,
            stderr_file=stderr_file,
        )

        kernel_kwargs = {"env": kwargs.get("kernel_env", {})}
        kernel_manager_class = final_kwargs.get("kernel_manager_class")
        if kernel_manager_class == "jupyter_server.gateway.managers.GatewayKernelManager":
            kernel_kwargs["kernel_name"] = kernel_name
            kernel_kwargs["path"] = kwargs.get("kernel_cwd")

        return JupyterMLNotebookClient(nb_man, kernel_id_observer=kernel_id_observer, **final_kwargs).execute(
            **kernel_kwargs
        )
