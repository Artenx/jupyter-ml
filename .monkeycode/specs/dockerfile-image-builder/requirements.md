# Requirements Document

## Introduction

Dockerfile Image Builder 为 Elyra Runtime Images 提供工作区 Dockerfile 在线编辑、本机 Docker CLI 构建、镜像仓库推送和运行时镜像登记能力。管理员可配置默认镜像仓库认证；每个已认证 Jupyter 用户可持久化管理个人仓库认证，并在构建时选择认证来源。

## Glossary

- **构建任务**：一次 Dockerfile 校验、镜像构建、推送和运行时镜像登记流程。
- **构建上下文**：Dockerfile 所在工作区目录及其子目录。
- **管理员认证**：Jupyter Server 管理员配置的默认镜像仓库地址、用户名和访问令牌。
- **个人认证**：与已认证 Jupyter 用户关联的镜像仓库地址、用户名和访问令牌。
- **认证配置**：管理员认证或个人认证的可选择命名配置。
- **Runtime Image**：Elyra Runtime Images schemaspace 中可供 Pipeline 节点选择的镜像引用。

## Requirements

### Requirement 1: Dockerfile 编辑与构建上下文

**User Story:** AS Elyra 用户，I want 在 JupyterLab 中编辑工作区 Dockerfile 并提交构建，so that 可以创建项目所需运行环境镜像。

#### Acceptance Criteria

1. WHEN 用户从工作区选择 Dockerfile，Dockerfile Image Builder SHALL 在编辑器中加载 Dockerfile 内容和所在目录。
2. WHEN 用户创建 Dockerfile，Dockerfile Image Builder SHALL 在用户指定的工作区路径创建 Dockerfile 并打开编辑器。
3. WHEN 用户保存 Dockerfile，Dockerfile Image Builder SHALL 将编辑内容保存到选定工作区路径。
4. WHEN 用户提交构建任务，Dockerfile Image Builder SHALL 将 Dockerfile 所在目录作为 Docker CLI 构建上下文。
5. IF 用户请求的 Dockerfile 路径位于 Jupyter Server 工作区根目录之外，Dockerfile Image Builder SHALL 拒绝构建请求并返回路径验证错误。

### Requirement 2: 本机镜像构建与可观察性

**User Story:** AS Elyra 用户，I want 查看镜像构建状态和日志，so that 可以诊断 Dockerfile 与依赖问题。

#### Acceptance Criteria

1. WHEN 用户提交包含镜像名称和标签的有效构建任务，Dockerfile Image Builder SHALL 通过 Jupyter Server 主机的 Docker CLI 执行镜像构建。
2. WHILE 构建任务处于队列或运行状态，Dockerfile Image Builder SHALL 返回任务状态、开始时间和按时间顺序的构建日志。
3. WHEN Docker CLI 返回成功状态，Dockerfile Image Builder SHALL 将构建任务标记为成功并记录完整镜像引用。
4. IF Docker CLI 返回失败状态，Dockerfile Image Builder SHALL 将构建任务标记为失败并记录经凭据脱敏的错误摘要和构建日志。
5. WHEN 用户请求停止活动构建任务，Dockerfile Image Builder SHALL 请求 Docker CLI 终止该构建任务并记录停止状态。

### Requirement 3: 镜像仓库认证

**User Story:** AS Elyra 用户，I want 使用管理员默认认证或个人认证推送镜像，so that 可以向授权仓库发布运行环境。

#### Acceptance Criteria

1. WHEN 管理员配置默认镜像仓库认证，Dockerfile Image Builder SHALL 将该认证配置作为已认证用户的可选默认认证。
2. WHEN 用户保存个人认证，Dockerfile Image Builder SHALL 将镜像仓库地址、用户名和访问令牌持久化到用户隔离的服务端凭据存储。
3. WHEN 用户提交推送任务并选择个人认证，Dockerfile Image Builder SHALL 使用该用户的个人认证执行 Docker CLI 登录和推送。
4. WHEN 用户提交推送任务并选择管理员认证，Dockerfile Image Builder SHALL 使用管理员认证执行 Docker CLI 登录和推送。
5. WHILE API 返回认证配置、构建任务或日志，Dockerfile Image Builder SHALL 排除访问令牌和 Docker CLI 登录密码。
6. WHILE 用户管理个人认证，Dockerfile Image Builder SHALL 返回该用户拥有的认证配置。
7. WHEN 用户删除个人认证，Dockerfile Image Builder SHALL 删除该认证配置并使后续构建任务无法选择该认证。

### Requirement 4: 推送与 Runtime Images 集成

**User Story:** AS Elyra 用户，I want 将已推送镜像登记为 Runtime Image，so that 可以直接在 Elyra Pipeline 中选择该镜像。

#### Acceptance Criteria

1. WHEN 用户选择推送已成功构建的镜像，Dockerfile Image Builder SHALL 使用所选认证配置将完整镜像引用推送到镜像仓库。
2. WHEN 镜像推送成功，Dockerfile Image Builder SHALL 提供将完整镜像引用添加为 Runtime Image 的操作。
3. WHEN 用户确认添加 Runtime Image，Dockerfile Image Builder SHALL 创建或更新 Runtime Images 元数据中的镜像引用、显示名称和可选描述。
4. IF 镜像推送失败，Dockerfile Image Builder SHALL 保留本机构建结果并记录经凭据脱敏的失败摘要。

### Requirement 5: 访问控制与保留

**User Story:** AS Elyra 用户，I want 仅访问个人构建任务和认证配置，so that 构建历史和个人凭据保持隔离。

#### Acceptance Criteria

1. WHILE 用户通过 Jupyter Server 访问 Dockerfile Image Builder API，Dockerfile Image Builder SHALL 使用现有认证上下文确定用户归属。
2. WHEN 用户查询构建任务、构建日志或个人认证，Dockerfile Image Builder SHALL 返回该用户拥有的资源。
3. WHEN 构建任务完成，Dockerfile Image Builder SHALL 保留构建元数据和日志 90 天或最近 100 条记录中的较长范围。
4. WHEN 用户删除已完成构建任务，Dockerfile Image Builder SHALL 删除任务元数据和本地构建日志，并保留 Docker 主机上的镜像。
