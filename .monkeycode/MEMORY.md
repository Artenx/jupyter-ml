# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-07-29
- Context: Discovered by Agent while performing local pipeline scheduling verification
- Category: Testing Methods
- Instructions:
  - The complete backend suite is `python3 -m pytest -v --durations=0 --durations-min=60 elyra --cov --cov-report=xml`.
  - Local pipeline execution tests require an installed and registered `python3` Jupyter kernel from `ipykernel`.
  - Airflow and KFP pipeline compilation tests require the declared `black~=26.1` dependency; the CLI test requires the declared `click==8.1.8` version.
  - KFP bootstrap tests require Docker CLI, image-build support, and the `minio/minio` Docker Hub image. When registry is unreachable, use `moto[s3]` with `MINIO_HOST_PORT=127.0.0.1:9000` and a `conftest.py` monkeypatch (see `elyra/tests/kfp/conftest.py`) to bypass Docker container startup.
  - Metadata inaccessible-directory tests require execution as a non-root user.

[Project Knowledge Summary]
- Date: 2026-07-30
- Context: Discovered by Agent while verifying Pipeline Editor scheduling tests
- Category: Testing Methods
- Instructions:
  - Jest uses `ts-jest`; its configuration must use the lowercase `tsconfig` option.
  - `testutils/tsconfig.jest.json` overrides the base Node16 settings with CommonJS and node module resolution so Jest transforms TypeScript test files correctly.

[Project Knowledge Summary]
- Date: 2026-07-30
- Context: Discovered by Agent while building a Kubeflow Notebook image
- Category: Build Methods
- Instructions:
  - Build the current source wheel with `python3 -m build --wheel`, then use `etc/docker/kubeflow/Dockerfile` and `ELYRA_VERSION` to build the Kubeflow Notebook image.
  - The image is compatible with x86_64 through `docker build --platform linux/amd64`; the current Docker installation may lack the Buildx plugin.

[Project Knowledge Summary]
- Date: 2026-08-18
- Context: Discovered by Agent while implementing the zero-fork local-scheduling frontend plugin
- Category: Build Methods
- Instructions:
  - local-scheduling 前端验证命令（在 `plugins/local-scheduling` 目录）：
    - `npm install --no-audit --no-fund`（首次约 3 分钟，安装 900+ 包）
    - 类型检查：`./node_modules/.bin/tsc --noEmit`
    - 测试：`./node_modules/.bin/jest`
  - Jest 配置要点（`jest.config.js`）：`@jupyterlab/*` 等为 ESM，必须设置 `transformIgnorePatterns: ['/node_modules/(?!(@jupyterlab/.*)/).+']` 让 ts-jest 转译；`\\.svg$` 用 `@glen/jest-raw-loader` 转译；需 `setupFilesAfterEnv: ['<rootDir>/jest.setup.js']`（`isomorphic-fetch` + `crypto.getRandomValues` polyfill）与 `setupFiles: ['@jupyterlab/testing/lib/jest-shim.js']`。
  - `@types/react` 18.0.26 / `@types/react-dom` 18.0.9 均无 `act` 类型；需升级到 `@types/react` 18.2.8 + `@types/react-dom` 18.2.4，测试里用 `import { act } from 'react-dom/test-utils'`。

[Project Knowledge Summary]
- Date: 2026-08-18
- Context: Discovered by Agent while choosing frontend dependencies for the zero-fork plugin
- Category: Troubleshooting & Debugging
- Instructions:
  - npm 上 `@elyra/services` 与 `@elyra/ui-components` 最新版本为 3.15.0，仅兼容 JupyterLab 3；Elyra 4.x 没有发布 JupyterLab 4 版本，其前端以 Python wheel 内嵌预构建 labextension 分发。
  - 零 fork 前端插件需自实现最小 API：用 `@jupyterlab/services`（`ServerConnection.makeSettings`/`makeRequest`）与 `@jupyterlab/coreutils`（`URLExt`）实现请求，本地定义类型/图标/错误提示，不依赖 `@elyra/*` npm 包。

[Project Knowledge Summary]
- Date: 2026-08-18
- Context: Discovered by Agent while verifying the zero-fork property of both plugins
- Category: Testing Methods
- Instructions:
  - 零 fork 验证方法：`python3 -m pip install --break-system-packages --target /tmp/opencode/upstream-elyra elyra==4.1.1 --no-deps`，然后从插件目录以 `PYTHONPATH=/tmp/opencode/upstream-elyra python3 -m pytest -q` 运行测试，确认 `elyra` 从上游 wheel 导入（`import elyra; print(elyra.__file__)`）而非 fork 源码。
  - fork 基于上游 `elyra` v4.1.1（base commit `88514128 Release v4.1.1`），故上游 4.1.1 可直接作为零 fork 验证基准。

[Project Knowledge Summary]
- Date: 2026-08-18
- Context: Discovered by Agent while verifying zero-fork with upstream Elyra 4.1.1
- Category: Troubleshooting & Debugging
- Instructions:
  - 上游 elyra wheel 不包含 `elyra/tests/` 目录；插件测试资源（如 `node.py`）若用 `from elyra.tests.pipeline.resources.node_util.node_util import ...` 会 ImportError，应改为相对 import `from node_util.node_util import ...`（与 `node.ipynb` 一致）。
  - 上游 `elyra.pipeline.handlers.PipelineSchedulerHandler` 没有 `owner_id` 属性（fork 在 09458f58 新增）；任何继承它的插件 handler 若使用 `self.owner_id`，必须自行定义该 property，不能依赖基类。

[Project Knowledge Summary]
- Date: 2026-08-18
- Context: Discovered by Agent while verifying plugins after removing the fork source
- Category: Troubleshooting & Debugging
- Instructions:
  - `local-scheduling` 的 `test_scheduler_retries_failed_run_with_configured_backoff` 偶发失败（涉及线程池 future `result(timeout=1)` 与 `run_due` 重试时序）；单独运行或重跑完整套件即通过。遇到该测试失败时先重跑确认，不必视为回归。
