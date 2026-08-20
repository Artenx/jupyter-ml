# Decouple Elyra and Schedule Plain Files

Feature Name: decouple-elyra-plain-files
Created: 2026-08-20
Status: Feasibility confirmed (research only, not yet implemented)

## Problem Statement

当前 job-scheduler 插件完全依赖 Elyra 的 pipeline 运行时：创建定时任务必须先在 Pipeline Editor 中保存一个 `.pipeline` 文件，再由 Elyra 的 `PipelineParser` 解析、由 Elyra 的处理器基类执行。这带来两个痛点：

1. 用户只想定时跑一个普通 `.py` 脚本或 `.ipynb` notebook 时，仍被迫走 pipeline 编辑器流程。
2. 插件与 Elyra 版本强耦合，且通过 monkey-patch `PipelineSchedulerHandler.post` 拦截直接运行，属于脆弱实现。

本特性研究验证：**能否在不依赖 Elyra 的前提下，直接基于普通 `.py` / `.ipynb` / `.R` 文件创建定时任务**。结论为可行。

## Feasibility Summary

执行核心早已与 Elyra 解耦：

- Notebook 执行 = `papermill.execute_notebook(..., engine_name="JupyterMLEngine")`，papermill 与自研引擎，运行时不依赖 Elyra。
- Python/R 执行 = `subprocess_run([sys.executable / "Rscript", filepath], stdout=PIPE, stderr=PIPE)`，纯标准库。
- 输出捕获、节点名日志分组、`output_observer`/`run_observer` 钩子均在自有代码中。

Elyra 仅存在于"包裹层"：`processor.py` 的基类继承、`engine.py` 的 `ElyraEngine` 基类、`scheduler.py` 的 `PipelineParser`、`app.py`/`override.py`/`handlers.py` 的提交处理器与校验。这些均为薄包装，可自实现。

## Out of Scope (this study)

- 不做代码实现，仅产出需求与设计文档。
- DAG 拓扑排序（多文件依赖图）暂不在本期范围；本期仅支持顺序执行。
