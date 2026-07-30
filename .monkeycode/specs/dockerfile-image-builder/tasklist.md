# 需求实施计划

- [x] 1. 实现镜像构建领域模型、用户隔离存储与管理员配置
  - [x] 1.1 在 `elyra/images/` 实现构建任务、状态、日志、个人认证摘要和路径或镜像引用校验，覆盖需求 1.4-1.5、2.1-2.5、3.2、5.1-5.4。
  - [x] 1.2 实现用户隔离的构建记录、日志和加密个人认证存储，并通过 Traitlets 配置管理员默认仓库认证与主密钥，覆盖需求 3.1-3.7、5.2-5.4。
  - [x] 1.3 为模型校验、路径边界、认证摘要脱敏、用户隔离、保留策略和加密往返编写 pytest 测试，验证设计正确性属性 1、2、3。

- [x] 2. 实现 Docker CLI 构建、推送和 Runtime Image 登记服务
  - [x] 2.1 实现受 `ElyraApp` 生命周期管理的 `ImageBuildManager`，通过本机 Docker CLI 执行构建、日志采集、停止、认证登录和推送，覆盖需求 2.1-2.5、3.3-3.5、4.1、4.4。
  - [x] 2.2 实现工作区 Dockerfile 创建、读取和保存，以及推送成功后的 Runtime Images Metadata 登记，覆盖需求 1.1-1.5、4.2-4.3。
  - [x] 2.3 为 Docker 命令组装、状态迁移、停止、认证来源选择、失败脱敏和 Runtime Image 登记编写 pytest 测试，验证设计正确性属性 2、4、5。

- [x] 3. 提供用户隔离的 Dockerfile Image Builder REST API
  - [x] 3.1 在 `elyra/images/handlers.py` 和 `elyra/elyra_app.py` 中提供 Dockerfile、构建、日志、推送、Runtime Image 和个人认证端点，覆盖需求 1.1-1.5、2.2、3.1-3.7、4.1-4.4、5.1-5.4。
  - [x] 3.2 为 API 验证、构建控制、令牌排除、个人认证 CRUD、管理员认证回退和跨用户访问隔离编写 Tornado handler 测试，验证设计正确性属性 2、3、5。

- [x] 4. 实现 JupyterLab Dockerfile Image Builder 工作台
  - [x] 4.1 在 `packages/pipeline-editor` 中创建 Dockerfile 编辑、镜像引用、认证选择、构建状态、日志、推送和 Runtime Image 登记界面，覆盖需求 1.1-1.4、2.2-2.5、3.1-3.6、4.1-4.3。
  - [x] 4.2 将 Dockerfile Image Builder 入口集成到 Runtime Images Widget，并实现个人认证创建、更新和删除交互，覆盖需求 3.2、3.6-3.7、4.2-4.3。
  - [x] 4.3 为服务请求、认证选择、构建状态、日志、凭据输入清除、推送和 Runtime Image 登记编写 Jest 测试，覆盖需求 2.2-2.5、3.1-3.7、4.1-4.3。

- [ ] 5. 检查点 - 确保所有测试通过,如有疑问请询问用户
  - [ ] 5.1 运行新增 Python pytest 测试、Runtime Images API 测试和 Pipeline Editor Jest 测试，修复本功能引入的回归。
