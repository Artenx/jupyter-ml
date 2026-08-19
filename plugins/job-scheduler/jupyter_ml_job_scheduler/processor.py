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
"""Local pipeline processor that extends the upstream Elyra implementation.

This processor overrides the ``local`` processor entry point so that scheduled,
direct, and retried runs can observe node lifecycle events, cancel cooperatively,
and report Enterprise Gateway kernel identifiers without modifying upstream Elyra.
"""

from __future__ import annotations

from datetime import datetime
import os
import threading
import time
from typing import Callable
from typing import Dict
from typing import Optional
from typing import Set

from jupyter_server.gateway.managers import GatewayClient
import papermill

from elyra.pipeline import pipeline_constants
from elyra.pipeline.local.local_processor import LocalPipelineProcessor as BaseLocalPipelineProcessor
from elyra.pipeline.local.local_processor import LocalPipelineProcessorResponse
from elyra.pipeline.local.local_processor import NotebookOperationProcessor as BaseNotebookOperationProcessor
from elyra.pipeline.local.local_processor import OperationProcessor
from elyra.pipeline.processor import PipelineProcessor
from elyra.pipeline.runtime_type import RuntimeProcessorType

RunResultObserver = Callable[[str, str, str, Optional[str]], None]
OutputObserver = Callable[[str, str, Optional[str]], None]


class LocalPipelineStoppedError(RuntimeError):
    """Raised when a managed local pipeline receives a stop request."""


class NotebookOperationProcessor(BaseNotebookOperationProcessor):
    """Notebook operation processor that reports Enterprise Gateway kernel identifiers."""

    def process(
        self,
        operation,
        elyra_run_name: str,
        remote_kernel_observer: Optional[Callable[[str], None]] = None,
        result_observer: Optional[RunResultObserver] = None,
        output_observer: Optional[OutputObserver] = None,
    ):
        filepath = self.get_valid_filepath(operation.filename)
        file_dir = os.path.dirname(filepath)
        file_name = os.path.basename(filepath)

        self.log.debug(f"Processing notebook: {filepath}")

        additional_kwargs = dict()
        additional_kwargs["engine_name"] = "JupyterMLEngine"
        additional_kwargs["cwd"] = file_dir
        additional_kwargs["kernel_cwd"] = file_dir
        additional_kwargs["kernel_env"] = OperationProcessor._collect_envs(operation, elyra_run_name)
        if GatewayClient.instance().gateway_enabled:
            additional_kwargs["kernel_manager_class"] = "jupyter_server.gateway.managers.GatewayKernelManager"
            additional_kwargs["kernel_id_observer"] = remote_kernel_observer

        t0 = time.time()
        try:
            nb = papermill.execute_notebook(filepath, filepath, **additional_kwargs)
            self._extract_outputs(nb, output_observer, operation.name)
        except papermill.PapermillExecutionError as pmee:
            self.log.error(
                f"Error executing {file_name} in cell {pmee.exec_count}: " + f"{str(pmee.ename)} {str(pmee.evalue)}"
            )
            raise RuntimeError(
                f"({file_name}) in cell {pmee.exec_count}: " + f"{str(pmee.ename)} {str(pmee.evalue)}"
            ) from pmee
        except Exception as ex:
            self.log_and_raise(file_name, ex)

        t1 = time.time()
        duration = t1 - t0
        self.log.debug(f"Execution of {file_name} took {duration:.3f} secs.")

        if result_observer:
            result_observer(filepath, file_name, "notebook", operation.name)

    def _extract_outputs(self, nb, output_observer: Optional[OutputObserver], operation_name: Optional[str]) -> None:
        if not output_observer:
            return
        for cell in nb.cells:
            if not hasattr(cell, "outputs"):
                continue
            for output in cell.outputs:
                if output.output_type == "stream" and output.get("name") in ("stdout", "stderr"):
                    text = output.get("text", "")
                    if text:
                        level = "WARN" if output.name == "stderr" else "INFO"
                        for line in text.rstrip("\n").split("\n"):
                            if line.strip():
                                output_observer(level, line, operation_name)
                elif output.output_type in ("error",):
                    ename = output.get("ename", "")
                    evalue = output.get("evalue", "")
                    traceback_lines = output.get("traceback", [])
                    if ename or evalue:
                        output_observer("ERROR", f"{ename}: {evalue}", operation_name)
                    for tb_line in traceback_lines:
                        clean_line = "".join(c for c in tb_line if c.isprintable() or c in "\n\r\t")
                        if clean_line.strip():
                            output_observer("ERROR", clean_line, operation_name)


class LocalPipelineProcessor(BaseLocalPipelineProcessor):
    """Local pipeline processor with lifecycle observation and cancellation."""

    _operation_processor_catalog: Dict
    _type = RuntimeProcessorType.LOCAL
    _name = "local"

    @property
    def supported_properties(self) -> Set[str]:
        """Elyra-owned properties supported by the job scheduler runtime."""
        return {pipeline_constants.ENV_VARIABLES}

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        notebook_op_processor = NotebookOperationProcessor(self.root_dir)
        self._operation_processor_catalog[notebook_op_processor.operation_name] = notebook_op_processor

    def process(
        self,
        pipeline,
        run_observer: Optional[Callable[[str, str, Optional[str]], None]] = None,
        cancel_event: Optional[threading.Event] = None,
        remote_kernel_observer: Optional[Callable[[str], None]] = None,
        result_observer: Optional[RunResultObserver] = None,
        output_observer: Optional[OutputObserver] = None,
    ):
        self.log_pipeline_info(pipeline.name, "processing pipeline")
        self._notify(run_observer, "INFO", "Local pipeline processing started.")
        t0_all = time.time()

        elyra_run_name = f'{pipeline.name}-{datetime.now().strftime("%m%d%H%M%S")}'

        operations = PipelineProcessor._sort_operations(pipeline.operations)
        for operation in operations:
            try:
                if cancel_event and cancel_event.is_set():
                    raise LocalPipelineStoppedError("Local pipeline stop requested.")
                t0 = time.time()
                self._notify(run_observer, "INFO", "Operation started.", operation.name)
                operation_processor = self._operation_processor_catalog[operation.classifier]
                if isinstance(operation_processor, NotebookOperationProcessor):
                    operation_processor.process(
                        operation, elyra_run_name, remote_kernel_observer, result_observer, output_observer
                    )
                else:
                    operation_processor.process(operation, elyra_run_name)
                self.log_pipeline_info(
                    pipeline.name,
                    f"completed {operation.filename}",
                    operation_name=operation.name,
                    duration=(time.time() - t0),
                )
                self._notify(run_observer, "INFO", "Operation completed.", operation.name)
            except LocalPipelineStoppedError:
                raise
            except Exception as ex:
                self._notify(run_observer, "ERROR", str(ex), operation.name)
                raise RuntimeError(f"Error processing operation {operation.name} {str(ex)}") from ex

        self.log_pipeline_info(pipeline.name, "pipeline processed", duration=(time.time() - t0_all))
        self._notify(run_observer, "INFO", "Local pipeline processing completed.")

        return LocalPipelineProcessorResponse()

    @staticmethod
    def _notify(
        run_observer: Optional[Callable[[str, str, Optional[str]], None]],
        level: str,
        message: str,
        operation_name: Optional[str] = None,
    ) -> None:
        if run_observer:
            run_observer(level, message, operation_name)
