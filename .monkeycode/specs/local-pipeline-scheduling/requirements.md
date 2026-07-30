# Requirements Document

## Introduction

本功能为 Elyra 本地运行时提供基于 Cron 表达式的持久化调度、单实例执行、运行记录和日志查看能力。

## Glossary

- **本地调度任务**：包含管道定义、Cron 表达式和启用状态的持久化任务。
- **计划触发**：Cron 表达式命中的时间点。
- **运行记录**：一次计划触发对应的执行状态、时间和日志位置。
- **活动运行**：状态为 `running` 的运行记录。

## Requirements

### Requirement 1: 创建和管理调度任务

**User Story:** AS Elyra 用户，I want 为本地管道创建和管理 Cron 调度任务，so that 管道可以在指定时间自动执行。

#### Acceptance Criteria

1. WHEN 用户提交本地管道和 5 段 Cron 表达式，Elyra SHALL 创建持久化的本地调度任务。
2. WHEN 用户提供不符合 5 段 Cron 语法的表达式，Elyra SHALL 返回字段级验证错误。
3. WHEN 用户更新调度任务的 Cron 表达式或启用状态，Elyra SHALL 持久化更新后的任务定义。
4. WHEN 用户删除调度任务，Elyra SHALL 移除任务定义并停止该任务的后续计划触发。
5. WHILE Jupyter Server 启动，Elyra SHALL 载入持久化的启用任务并注册后续计划触发。

### Requirement 2: 执行调度任务

**User Story:** AS Elyra 用户，I want 本地管道按计划运行，so that 重复工作可以自动完成。

#### Acceptance Criteria

1. WHEN 计划触发到达且对应任务没有活动运行，Elyra SHALL 创建运行记录并执行本地管道。
2. WHILE 本地调度任务具有活动运行，Elyra SHALL 将同一任务的新计划触发记录为 `skipped`。
3. WHEN Jupyter Server 恢复运行，Elyra SHALL 从恢复时刻开始计算后续计划触发。
4. WHEN 本地管道执行结束，Elyra SHALL 将运行记录更新为 `succeeded` 或 `failed`。

### Requirement 3: 查看运行记录

**User Story:** AS Elyra 用户，I want 查看每个调度任务的运行历史，so that 可以确认自动执行结果。

#### Acceptance Criteria

1. WHEN 用户请求调度任务的运行记录，Elyra SHALL 返回触发时间、开始时间、结束时间、状态和运行标识。
2. WHEN 用户按任务、状态或时间范围筛选运行记录，Elyra SHALL 返回满足筛选条件的记录。
3. WHEN 用户打开 Pipeline Editor 的本地调度任务，Elyra SHALL 显示该任务的运行记录列表。
4. WHEN 系统创建跳过记录，Elyra SHALL 保存跳过原因和计划触发时间。
5. WHEN 系统保存运行记录，Elyra SHALL 保留最近 100 条记录和最近 90 天内的记录。

### Requirement 4: 查看运行日志

**User Story:** AS Elyra 用户，I want 查看每次本地运行的日志，so that 可以诊断执行结果和失败原因。

#### Acceptance Criteria

1. WHEN 本地调度运行开始，Elyra SHALL 创建与运行标识关联的日志流。
2. WHILE 本地调度运行执行，Elyra SHALL 将管道级和节点级日志写入该运行的日志流。
3. WHEN 用户请求运行日志，Elyra SHALL 按日志顺序返回日志条目、时间戳、级别和节点名称。
4. WHEN 本地调度运行失败，Elyra SHALL 在运行记录中保存错误摘要，并在日志流中保存异常详情。
5. WHEN 系统清理过期运行记录，Elyra SHALL 清理对应的运行日志。

### Requirement 5: API 与界面一致性

**User Story:** AS Elyra 用户，I want 通过 Pipeline Editor 管理本地调度，so that 调度配置与手动本地执行位于同一工作流中。

#### Acceptance Criteria

1. WHEN 用户选择 Local 运行时，Pipeline Editor SHALL 提供创建和编辑本地调度任务的入口。
2. WHEN 用户保存本地调度任务，Pipeline Editor SHALL 显示 Cron 表达式、启用状态和下次触发时间。
3. WHEN 本地调度任务产生新的运行记录，Pipeline Editor SHALL 在用户刷新任务详情时显示最新记录和日志入口。
4. WHEN Elyra REST API 接收调度任务、运行记录或日志请求，Elyra SHALL 使用现有 Jupyter Server 认证上下文处理请求。
