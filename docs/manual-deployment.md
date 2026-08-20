# 手动部署文档：JupyterLab + jupyter-ml job-scheduler 插件

本文档从零开始，逐条命令描述如何在干净环境中部署 JupyterLab 与 `jupyter-ml-job-scheduler`
定时任务调度插件，并包含 Kernel Provisioner（本地/远程 kernel）的安装与配置，最后说明如何将
整套环境打包固化成容器镜像。

> 本文使用**原生命令**，不依赖仓库内封装的 `start.sh`。

---

## 0. 组件与版本清单（已在目标环境验证可运行）

| 组件 | 版本 | 说明 |
|------|------|------|
| Python | 3.11 | 运行环境 |
| Node.js | 22.x | 前端构建（由 `jlpm` 调用） |
| `jupyterlab` | 4.4.2 | JupyterLab 前端/服务端壳 |
| `jupyter_server` | 2.20.0 | 服务端核心 |
| `jupyter_client` | 8.9.1 | Kernel 通信 + **Kernel Provisioner 框架**（≥7 内置） |
| `jupyterlab_server` | 2.28.0 | |
| `elyra` | 4.1.1 | 流水线编排（插件依赖其 processor/engine） |
| `papermill` | 2.7.0 | Notebook 执行引擎 |
| `ipykernel` | 7.3.0 | Python kernel |
| `jupyter_core` | 5.9.1 | |
| `tornado` | 6.5.8 | |
| `traitlets` | 5.16.1 | |
| `nbconvert` | 7.17.1 | |
| `jupyter_lsp` | 2.3.1 | 语言服务（可选） |
| `jupyter_resource_usage` | 1.1.1 | 资源占用显示（可选） |
| `nbdime` | 4.0.4 | Notebook diff（可选） |
| `notebook_shim` | 0.2.4 | 兼容层（可选） |
| `jupyter_server_terminals` | 0.5.4 | 终端（随 jupyter_server 拉入） |
| `jupyter-ml-job-scheduler`（本插件） | 0.1.0 | 定时调度插件 |

> 以上 Python 包通过 `pip` 安装；前端扩展通过 `jlpm`（JupyterLab 自带）构建。

---

## 1. 操作系统与基础依赖

以 Ubuntu 22.04 为例：

```bash
# 更新并安装编译/运行时基础库
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
    python3.11 python3.11-venv python3.11-dev \
    python3-pip build-essential \
    nodejs npm git curl \
    ca-certificates

# 确认版本
python3.11 --version
node --version
```

> 建议使用虚拟环境隔离依赖：
> ```bash
> python3.11 -m venv /opt/venv
> source /opt/venv/bin/activate
> ```

---

## 2. 安装 Python 依赖（JupyterLab + Elyra + 插件依赖）

创建 `requirements.txt`（固定版本，保证可复现）：

```text
jupyterlab==4.4.2
jupyter_server==2.20.0
jupyter_client==8.9.1
jupyterlab_server==2.28.0
elyra==4.1.1
papermill==2.7.0
ipykernel==7.3.0
jupyter_core==5.9.1
tornado==6.5.8
traitlets==5.16.1
nbconvert==7.17.1
jupyter_lsp==2.3.1
jupyter_resource_usage==1.1.1
nbdime==4.0.4
notebook_shim==0.2.4
jupyter_server_terminals==0.5.4
```

安装：

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

安装完成后，`jlpm`（JupyterLab 自带的 Yarn Berry 封装）已可用：

```bash
jlpm --version
```

---

## 3. 安装 job-scheduler 插件（Python 端）

进入插件目录并安装（开发态用 editable，生产可去掉 `-e`）：

```bash
cd /path/to/jupyter-ml/plugins/job-scheduler
pip install -e .
```

验证包已注册：

```bash
python -c "import jupyter_ml_job_scheduler; print(jupyter_ml_job_scheduler._version.__version__)"
# 期望输出：0.1.0
```

---

## 4. 构建并安装前端 labextension

前端扩展需要先安装 Node 依赖、再用 `jlpm build` 编译，最后用
`jupyter labextension install` 注册到 JupyterLab。

```bash
cd /path/to/jupyter-ml/plugins/job-scheduler

# 1) 安装前端依赖（生成 node_modules）
jlpm install

# 2) 编译 TS + 打包联邦扩展（产出到 share/jupyter/labextensions）
jlpm build

# 3) 将预构建扩展注册进 JupyterLab（--no-build 表示不重复打包）
jupyter labextension install . --no-build
```

验证扩展已安装：

```bash
jupyter labextension list
# 期望看到：@jupyter-ml/job-scheduler  enabled  ...
```

> 若已安装过，重复执行 `jlpm build && jupyter labextension install . --no-build` 会覆盖更新，幂等安全。

---

## 5. 配置 Jupyter

将以下配置写入 `/root/.jupyter/jupyter_lab_config.py`
（仓库内已固化副本：`plugins/job-scheduler/jupyter_lab_config.py`）。

```python
from jupyter_server.auth.identity import PasswordIdentityProvider, User


class StableIdentityProvider(PasswordIdentityProvider):
    """Identity provider that returns a stable username for single-user deployments."""

    def generate_anonymous_user(self, handler):
        return User(
            username="monkeycode",
            name="MonkeyCode",
            display_name="MonkeyCode",
            initials="MC",
            avatar_url=None,
            color=None,
        )


c = get_config()  # noqa: F821

# 密码哈希对应明文 "monkeycode"（如需修改，用 `jupyter server password` 重新生成）
c.ServerApp.password = 'argon2:$argon2id$v=19$m=10240,t=10,p=8$Y/KXz63XthDhQEn+BbgSWw$FjHjHmcpe3p+npi0IHYcqkdP1+i+mUz/n7SIS8jmMdw'
c.ServerApp.allow_root = True
c.ServerApp.ip = '0.0.0.0'
c.ServerApp.port = 8888
c.ServerApp.open_browser = False
c.ServerApp.allow_remote_access = True
c.ServerApp.allow_origin = '*'
c.ServerApp.root_dir = '/workspace'
c.ServerApp.identity_provider_class = StableIdentityProvider
c.ServerApp.jpserver_extensions = {
    "jupyter_ml_job_scheduler": True,
    "elyra": True,
    "jupyterlab": True,
    "jupyter_lsp": True,
    "jupyter_resource_usage": True,
    "jupyter_server_terminals": True,
    "nbdime": True,
    "notebook_shim": True,
}
```

> 若还部署了同仓的 `jupyter-ml-image-builder` 插件，可在 `jpserver_extensions` 中追加
> `"jupyter_ml_image_builder": True`（需先 `pip install` 该插件）。

确保目录存在：

```bash
mkdir -p /root/.jupyter
# 将上面的内容写入该文件（或直接从仓库拷贝）
cp /path/to/jupyter-ml/plugins/job-scheduler/jupyter_lab_config.py /root/.jupyter/jupyter_lab_config.py
```

---

## 6. 启动 JupyterLab

```bash
cd /workspace
jupyter lab \
    --config=/root/.jupyter/jupyter_lab_config.py \
    --allow-root \
    --no-browser
```

启动后访问 `http://<host>:8888`，使用密码 `monkeycode` 登录。
在侧边栏应能看到 **Job Scheduler** 面板；点击 "Create Job" 可看到包含 Kernel 下拉的对话框。

> 以 systemd / 容器方式常驻时，将上面的 `jupyter lab ...` 作为服务进程即可。

---

## 7. Kernel Provisioners 安装与配置

`jupyter_client` ≥ 7 已**内置 Kernel Provisioner 框架**，用于解耦“kernel 如何被启动”。
kernelspec 通过 `metadata.kernel_provisioner.provisioner_name` 声明启动方式，
与是否安装 Enterprise Gateway 无关。

### 7.1 本地 kernel（默认，无需额外安装）

默认 provisioner 为 `local-provisioner`，所有普通 kernelspec 即本地 kernel。
查看当前 kernelspec 及其 provisioner：

```bash
jupyter kernelspec list
# 调用 REST 可看 metadata：
curl -s "http://localhost:8888/api/kernelspecs" | python3 -m json.tool
```

本地 kernel 的 `spec.metadata` 通常没有 `kernel_provisioner` 字段。

### 7.2 自定义远程 provisioner（无需 Enterprise Gateway）

下面以“通过 SSH 在远程主机拉起 kernel”为例，演示 EG 无关的自定义 provisioner。

**(a) 编写 provisioner 包** `my_remote_provisioner/`：

```python
# my_remote_provisioner/provisioners.py
from jupyter_client.provisioning import KernelProvisionerBase


class MySshProvisioner(KernelProvisionerBase):
    """在远程主机上通过 SSH 启动 kernel 的最小示例。"""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.remote_host = self.kernel_spec.metadata.get(
            "kernel_provisioner", {}
        ).get("config", {}).get("host", "localhost")

    async def launch_kernel(self, kernel_cmd, **kwargs):
        # 在此用 subprocess/asyncssh 在 self.remote_host 上执行 kernel_cmd
        # 并返回 (connection_info, process_proxy)
        raise NotImplementedError("实现你的远程启动逻辑")

    async def shutdown(self):
        # 清理远程进程
        ...
```

**(b) 注册入口点**（`pyproject.toml`）：

```toml
[project.entry-points."jupyter_client.kernel_provisioners"]
my-ssh-provisioner = "my_remote_provisioner.provisioners:MySshProvisioner"
```

**(c) 安装并创建对应 kernelspec**：

```bash
pip install -e ./my_remote_provisioner
mkdir -p /tmp/my-ssh-kernel
cat > /tmp/my-ssh-kernel/kernel.json <<'JSON'
{
  "display_name": "Remote Python (SSH)",
  "language": "python",
  "argv": ["python", "-m", "ipykernel_launcher", "-f", "{connection_file}"],
  "metadata": {
    "kernel_provisioner": {
      "provisioner_name": "my-ssh-provisioner",
      "config": { "host": "10.0.0.5" }
    }
  }
}
JSON
jupyter kernelspec install /tmp/my-ssh-kernel --name remote-ssh-python
```

**(d) 校验**：

```bash
curl -s "http://localhost:8888/api/kernelspecs" | python3 -c \
  "import sys,json; d=json.load(sys.stdin); print(d['kernelspecs']['remote-ssh-python']['spec']['metadata'])"
# 期望输出含 {'kernel_provisioner': {'provisioner_name': 'my-ssh-provisioner', 'config': {'host': '10.0.0.5'}}}
```

### 7.3 Enterprise Gateway（开箱即用的远程 provisioner，可选）

若希望直接使用 Kubernetes / YARN / Spark / Distributed / Gateway 等现成远程能力：

```bash
pip install jupyter-enterprise-gateway
```

- 启动一个 Enterprise Gateway 服务，并设置环境变量 `JUPYTER_GATEWAY_URL=http://<eg-host>:8888`。
- EG 会自动注册 `kubernetes-provisioner`、`yarn-provisioner`、`spark-provisioner`、
  `distributed-provisioner`、`gateway-provisioner` 等入口。
- 创建 kernelspec 时只需在 `metadata.kernel_provisioner.provisioner_name` 指定对应名称，例如：

```json
{
  "display_name": "Kubernetes Python",
  "language": "python",
  "argv": ["python", "-m", "ipykernel_launcher", "-f", "{connection_file}"],
  "metadata": { "kernel_provisioner": { "provisioner_name": "kubernetes-provisioner" } }
}
```

> 注意：本插件仅在 `GatewayClient.instance().gateway_enabled` 为 `True` 时切换到
> `GatewayKernelManager`；使用 EG 远程 provisioner 时请同时开启 Gateway 模式
> （环境变量 `JUPYTER_GATEWAY_URL` 或 `c.GatewayClient.url`）。

### 7.4 在 job-scheduler 中使用

创建/编辑调度任务时，对话框的 **Kernel** 下拉会列出所有 kernelspec，并按 provisioner 标注：

- `local-provisioner` → `Local`
- 含 `kubernetes` → `Remote (Kubernetes)`，其余类似（`YARN`/`Spark`/`Distributed`/`Gateway`）
- 未配置 provisioner 的未知项 → `Local`

选择某项后，该 `kernel_name` 会被持久化并在执行时传给 papermill；**留空 = 使用 notebook 自身
kernelspec（向后兼容）**。

---

## 8. 打包固化成镜像

### 8.1 多阶段 Dockerfile

将仓库作为构建上下文（`/workspace/jupyter-ml`）。`Dockerfile` 放在仓库根目录：

```dockerfile
# ---------- 阶段 1：前端构建 ----------
# 需要 jupyterlab 提供 jlpm，以及 node 执行 tsc/打包
FROM python:3.11-slim AS frontend
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git curl nodejs npm \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir jupyterlab==4.4.2

WORKDIR /build
COPY plugins/job-scheduler ./plugins/job-scheduler
WORKDIR /build/plugins/job-scheduler
# jlpm 由 jupyterlab 提供；build = tsc + jupyter labextension build .
RUN jlpm install \
    && jlpm build

# ---------- 阶段 2：运行时 ----------
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    JUPYTER_CONFIG=/root/.jupyter/jupyter_lab_config.py

# 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

# Python 依赖（固定版本）
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# 安装插件（Python 端）
RUN pip install --no-cache-dir -e /app/plugins/job-scheduler

# 拷贝阶段 1 产出的预构建扩展
COPY --from=frontend /usr/local/share/jupyter/labextensions /usr/local/share/jupyter/labextensions

# 固化配置
RUN mkdir -p /root/.jupyter \
    && cp /app/plugins/job-scheduler/jupyter_lab_config.py /root/.jupyter/jupyter_lab_config.py

EXPOSE 8888
CMD ["jupyter", "lab", "--config=/root/.jupyter/jupyter_lab_config.py", "--allow-root", "--no-browser"]
```

配套 `requirements.txt` 即第 2 节内容；同时将 `pyproject`/`package.json` 锁文件纳入仓库以保证
可复现。

### 8.2 构建与运行

```bash
# 构建上下文为仓库根
docker build -t jupyter-ml-job-scheduler:0.1.0 .

# 运行（/workspace 作为数据卷挂载，配置已在镜像内固化）
docker run -d --name jml \
    -p 8888:8888 \
    -v "$(pwd)/workspace-data:/workspace" \
    jupyter-ml-job-scheduler:0.1.0
```

### 8.3 镜像固化建议

- **预构建前端**：扩展在镜像构建期完成，运行时不再 `jlpm build`，启动更快、依赖更少。
- **配置入镜像**：`jupyter_lab_config.py` 已 `COPY` 进镜像，重启不依赖宿主机 `/root`。
- **数据外挂**：`/workspace` 用 volume 挂载，任务定义、日志、notebook 持久化在卷上。
- **远程 provisioner 同固化**：若使用 7.2/7.3 的远程 kernel，将对应 provisioner 包与 kernelspec
  也 `pip install` / `jupyter kernelspec install` 进镜像，避免运行时缺失。
- **版本锁**：`requirements.txt` 与 `yarn.lock` 一并提交，保证任意机器上构建出一致镜像。

---

## 9. 部署后自检清单

```bash
# 1) 扩展已加载
jupyter labextension list | grep job-scheduler

# 2) Python 包可导入
python -c "import jupyter_ml_job_scheduler, elyra"

# 3) 服务可访问且扩展注册
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8888/api/status   # 403=需登录，正常
curl -s "http://localhost:8888/api/kernelspecs" | python3 -m json.tool       # 列出可用 kernel

# 4) 创建调度（带 kernel_name）通过 UI 或 REST：
#    POST /jupyter-ml/local/schedules  body: {display_name, pipeline_definition, cron_expression, enabled, kernel_name?}
```
