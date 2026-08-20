# Requirements: Decouple Elyra and Schedule Plain Files

Feature Name: decouple-elyra-plain-files
Created: 2026-08-20

本需求文档采用 EARS 模式描述。

## Functional Requirements

### FR-1 基于普通文件创建定时任务

- **When** 用户在创建定时任务对话框中选择工作区中的一个 `.py`、`.ipynb` 或 `.R` 文件，**the system shall** 允许在不打开 Pipeline Editor 的情况下创建定时任务。
- **Where** 所选文件为 `.ipynb`，**the system shall** 使用 papermill 引擎执行该 notebook 并捕获其单元格输出。
- **Where** 所选文件为 `.py`，**the system shall** 使用当前 Python 解释器以子进程方式执行并捕获 stdout/stderr。
- **Where** 所选文件为 `.R`，**the system shall** 使用 `Rscript` 以子进程方式执行并捕获 stdout/stderr。

### FR-2 多文件顺序执行

- **When** 一个定时任务定义了多个文件，**the system shall** 按声明顺序依次执行每个文件。
- **If** 某个文件执行失败，**the system shall** 中止后续文件执行并将该任务标记为失败，同时保留已捕获的日志。

### FR-3 移除 Elyra 运行时依赖

- **The system shall** 在运行时不再导入 `elyra` 包的任何模块（包括 `elyra.pipeline.*`、`elyra.util.*`）。
- **The system shall** 将 papermill 引擎基类从 `ElyraEngine` 改为 papermill 自带的 `NBClientEngine`，保留远程 Enterprise Gateway 内核 ID 上报能力。

### FR-4 保留现有能力

- **The system shall** 保留运行日志按节点（文件）分组的展示能力。
- **The system shall** 保留 stdout/stderr 与错误 traceback 的捕获与结构化存储。
- **If** Jupyter Server 配置了 Enterprise Gateway，**the system shall** 在执行 notebook 时通过 `GatewayKernelManager` 上报内核 ID。

### FR-5 存量兼容

- **The system shall** 继续支持已存在的以 Elyra `.pipeline` JSON 存储的调度任务，通过轻量适配器在加载时将 `pipelines[0].nodes` 解析为文件列表，避免依赖 Elyra 解析器。

### FR-6 提交入口自有化

- **The system shall** 使用自有提交 handler（如 `/jupyter-ml/local/submit`）替代对 Elyra `PipelineSchedulerHandler.post` 的 monkey-patch。
- **When** 用户通过前端"直接运行"触发执行，**the system shall** 将运行记录写入本地运行历史，行为与现有实现一致。

## Non-Functional Requirements

### NFR-1 校验简化

- **The system shall** 用文件存在性与类型校验替代 Elyra `PipelineValidationManager`，避免引入 Elyra 依赖。

### NFR-2 测试

- **The system shall** 保留并扩展现有单元测试（处理器、调度器、前端服务），覆盖 `.py` / `.ipynb` / `.R` 三类文件的执行与日志捕获。
