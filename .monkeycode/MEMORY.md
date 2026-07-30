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
