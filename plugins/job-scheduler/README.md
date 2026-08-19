# jupyter-ml-job-scheduler

Job scheduling and task management for Elyra/JupyterLab.

This package is a zero-fork Jupyter Server extension that restores the local
pipeline scheduling capabilities of the jupyter-ml distribution on top of the
upstream `elyra` package. It provides:

- Persistent local pipeline schedules with cron triggers and retry policies.
- A run history that records scheduled, manual, retried, and direct runs.
- Structured run logs and output results.
- A `local` pipeline processor that reports Enterprise Gateway kernel ids.

## Installation

```bash
pip install jupyter-ml-job-scheduler
```

Enable the server extension:

```bash
jupyter server extension enable --py jupyter_ml_job_scheduler
```

## Development

```bash
pip install -e ".[test]"
pytest
```
