# Requirements Document

## Introduction

本功能扩展现有 Local Pipeline Scheduling，实现 Local Pipeline 任务的完整管理。管理范围包括计划、运行实例、重试、日志、输出结果、查看和删除。Local Pipeline 的 Notebook 节点可通过 Jupyter Enterprise Gateway 在远程 Kernel 中执行。

## Glossary

- **任务定义**：可由用户手动运行或按计划触发的 Elyra Pipeline 定义。
- **计划**：关联任务定义的 Cron 触发规则。
- **运行实例**：一次任务提交或计划触发产生的独立执行记录。
- **远程 Kernel**：由 Jupyter Enterprise Gateway 为 Local Pipeline Notebook 节点启动的远程执行环境。
- **重试策略**：定义失败运行实例的最大尝试次数、重试间隔和可重试状态的规则。
- **输出结果**：运行实例产生的 Pipeline 文件、节点产物、远程任务标识和可访问结果链接。

## Requirements

### Requirement 1: 统一任务视图

**User Story:** AS Elyra 用户，I want 在 JupyterLab 中查看所有 Pipeline 任务与运行实例，so that 可以掌握任务状态和执行环境。

#### Acceptance Criteria

1. WHEN 用户打开任务管理视图，Elyra SHALL 显示任务名称、运行时、计划状态、最近运行状态和下次触发时间。
2. WHEN 用户按运行时、任务状态、运行状态或时间范围筛选，Elyra SHALL 显示满足筛选条件的任务与运行实例。
3. WHEN 用户打开运行实例详情，Elyra SHALL 显示运行标识、触发来源、尝试次数、时间线、状态、日志和输出结果。

### Requirement 2: 计划管理

**User Story:** AS Elyra 用户，I want 创建和维护任务计划，so that 可以控制任务的自动执行。

#### Acceptance Criteria

1. WHEN 用户提交任务定义和 Cron 表达式，Elyra SHALL 创建关联计划并计算下次触发时间。
2. WHEN 用户修改计划表达式、启用状态或重试策略，Elyra SHALL 保存修改后的计划并重新计算下次触发时间。
3. WHEN 用户停用计划，Elyra SHALL 保留计划与运行历史并停止后续触发。
4. WHEN 用户删除计划，Elyra SHALL 移除计划定义并保留已完成运行实例的查询记录。

### Requirement 3: 运行控制与重试

**User Story:** AS Elyra 用户，I want 控制失败任务的重试，so that 临时执行错误可以得到恢复。

#### Acceptance Criteria

1. WHEN 用户创建或更新任务时提供最大尝试次数、初始重试间隔或退避倍率，Elyra SHALL 验证并保存用户提供的重试策略。
2. WHEN 运行实例进入可重试失败状态且剩余尝试次数大于零，Elyra SHALL 按任务的指数退避策略创建后续尝试。
3. WHEN 用户请求手动重试已完成运行实例，Elyra SHALL 以原始任务定义和参数创建新的尝试。
4. WHEN 用户停止活动运行实例，Elyra SHALL 请求对应运行时停止执行并记录停止结果。
5. WHEN 运行实例超过最大尝试次数，Elyra SHALL 将运行实例标记为最终失败并保留失败原因。
6. WHEN 用户未指定重试策略，Elyra SHALL 使用三次最大尝试次数、一分钟初始重试间隔和二倍退避倍率。

### Requirement 4: 日志与输出结果

**User Story:** AS Elyra 用户，I want 查看运行日志和输出结果，so that 可以诊断任务并访问产物。

#### Acceptance Criteria

1. WHILE 运行实例处于活动状态，Elyra SHALL 提供按时间顺序读取的任务级和节点级日志。
2. WHEN 运行实例完成，Elyra SHALL 保存状态、错误摘要、运行时任务标识和输出结果元数据。
3. WHEN 输出结果位于远程运行时，Elyra SHALL 显示结果位置与运行时提供的访问链接。
4. WHEN 用户请求运行实例详情，Elyra SHALL 显示全部可访问输出结果及其生成时间。

### Requirement 5: 删除与保留

**User Story:** AS Elyra 用户，I want 删除任务与运行记录，so that 可以维护可管理的任务历史。

#### Acceptance Criteria

1. WHEN 用户删除未关联活动运行的任务定义，Elyra SHALL 删除任务定义、关联计划和可配置保留范围内的本地元数据。
2. WHEN 用户删除运行记录，Elyra SHALL 删除对应的本地日志与结果元数据，并保留远程运行时的原始产物位置。
3. WHILE 任务或运行实例包含活动执行，Elyra SHALL 显示停止执行与删除管理记录的可选操作。

### Requirement 6: Enterprise Gateway 与访问控制

**User Story:** AS Elyra 用户，I want 管理通过 Enterprise Gateway 执行的 Local Pipeline Notebook，so that 可以使用远程计算资源并保持统一任务视图。

#### Acceptance Criteria

1. WHEN Elyra 管理 Local 运行时任务，Elyra SHALL 使用现有本地调度器、运行记录和日志存储。
2. WHEN Local Pipeline Notebook 节点使用 Enterprise Gateway 执行，Elyra SHALL 保存远程 Kernel 标识和远程执行状态。
3. WHILE 用户通过 Jupyter Server 访问任务管理 API，Elyra SHALL 使用现有认证上下文执行任务管理操作。
4. WHILE 用户查看任务、运行实例、日志或输出结果，Elyra SHALL 返回该用户拥有的管理记录。
