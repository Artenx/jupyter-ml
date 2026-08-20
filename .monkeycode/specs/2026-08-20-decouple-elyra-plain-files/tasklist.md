# Task List: Decouple Elyra and Schedule Plain Files

Feature Name: decouple-elyra-plain-files
Created: 2026-08-20
Status: Not started (research/design only)

## Implementation Steps

### T1 引擎解耦
- [ ] `engine.py`：`JupyterMLEngine` 基类由 `ElyraEngine` 改为 `papermill.engines.NBClientEngine`，验证 notebook 执行与 Gateway 内核 ID 上报正常。

### T2 处理器基类自研
- [ ] 新建 `processor.py` 自有基类：`OperationProcessor`、`FileOperationProcessor`、`NotebookProcessor`、`PythonScriptProcessor`、`RScriptProcessor`、`JobSchedulerProcessor`。
- [ ] 实现 `get_valid_filepath` / 自研 `get_absolute_path`，实现 `_collect_envs`（使用自有 `env_vars` 与 `JUPYTER_ML_*` 变量）。
- [ ] 迁移现有 `_extract_outputs` / `_capture_output` 与节点名 `operation_name` 透传逻辑。
- [ ] 移除所有 `from elyra...` 导入。

### T3 Pipeline 解析替换
- [ ] `scheduler.py`：移除 `PipelineParser`，新增 `ScheduleDefinition`（文件列表）解析。
- [ ] 实现存量 Elyra `.pipeline` JSON → 文件列表适配器 `from_elyra_pipeline`。
- [ ] `_default_execute_schedule` 改为按文件列表顺序执行。

### T4 提交入口自有化
- [ ] 新增 `JobSchedulerSubmitHandler`（路由 `/jupyter-ml/local/submit`），移除对 `PipelineSchedulerHandler.post` 的 monkey-patch。
- [ ] 移除 `PipelineValidationManager` / `PipelineProcessorManager`，改为文件存在性/类型校验。
- [ ] 更新 `app.py` 路由注册与 `override.py`/`handlers.py`。

### T5 数据模型兼容
- [ ] `models.py`：`LocalSchedule` 增加 `files: List[FileSpec]`；加载时优先 `files`，为空走 Elyra 适配器。
- [ ] `run_store` 与运行记录逻辑保持不变。

### T6 前端扩展
- [ ] `index.ts` / `JobSchedulerWidget.tsx`：文件选择器扩展至 `.py` / `.ipynb` / `.R`。
- [ ] `JobSchedulerService.ts`：`ILocalSchedulePayload` 增加 `files` 字段（保留 `pipeline_definition`）。
- [ ] 创建对话框支持多文件选择与顺序设置；单文件退化为单节点。

### T7 测试与部署
- [ ] 扩展 jest 单测覆盖 `.py` / `.ipynb` / `.R` 执行与日志分组。
- [ ] 扩展 Python 单测覆盖 `ScheduleDefinition` 解析、Elyra 适配器、处理器基类。
- [ ] 构建前端、`pip install` wheel、重启服务验证端到端。

## Verification

- 直接选择一个 `.py` 文件创建定时任务并运行，确认 stdout 被捕获且按文件名分组。
- 直接选择一个 `.ipynb` 文件运行，确认单元格输出被捕获且 Gateway 内核 ID 上报正常。
- 存量 `.pipeline` 调度任务仍可正常触发与展示。
- `grep -rn "import elyra" jupyter_ml_job_scheduler/` 返回空。
