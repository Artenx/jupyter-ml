# Requirements Document

## Introduction

The Dockerfile Image Builder currently presents every control in a single
vertical sequence. The refreshed workbench shall provide a clear authoring,
build, and delivery flow while preserving the existing Dockerfile, registry,
credential, build history, and Runtime Image capabilities.

## Glossary

- **Authoring area**: The workspace area containing Dockerfile path controls
  and Dockerfile content.
- **Build rail**: The workspace area containing image target, credential, and
  build controls.
- **Build detail**: The selected build status, delivery actions, and logs.

## Requirements

### Requirement 1

**User Story:** AS a pipeline author, I want a structured image build
workspace, so that I can identify the next authoring or delivery action.

#### Acceptance Criteria

1. THE Image Builder SHALL display a title, workflow description, and refresh
   action in a dedicated header.
2. THE Image Builder SHALL display the Authoring area and Build rail as
   visually distinct workspace regions on wide screens.
3. WHEN the available width is below the workspace breakpoint, THE Image
   Builder SHALL stack the workspace regions in authoring-to-build order.

### Requirement 2

**User Story:** AS a pipeline author, I want build status and history to be
easy to scan, so that I can select and inspect the appropriate build.

#### Acceptance Criteria

1. THE Image Builder SHALL show a status badge for each build history entry.
2. WHEN a build is selected, THE Image Builder SHALL visually identify the
   selected history entry.
3. WHEN a build has logs, THE Image Builder SHALL render logs in a dedicated
   monospace output area.

### Requirement 3

**User Story:** AS a registry user, I want registry credentials grouped
separately from image target input, so that I can manage credential records
without losing my current build context.

#### Acceptance Criteria

1. THE Build rail SHALL contain the image target, selected credential, and
   primary build action.
2. THE Image Builder SHALL place personal credential editing in a dedicated
   secondary section.
3. THE Image Builder SHALL preserve the existing credential create, update,
   edit, and delete behaviors.
