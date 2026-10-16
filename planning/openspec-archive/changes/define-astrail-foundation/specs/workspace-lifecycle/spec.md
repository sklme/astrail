## Purpose

Define the observable Astrail lifecycle for creating, consuming, inspecting, synchronizing, and updating an agent-oriented workspace without replacing normal repository development workflows.

## ADDED Requirements

### Requirement: Initialization supports authoring a new workspace
The `astrail init` workflow SHALL create or adopt an Astrail workspace definition, select the initial Codex target, and produce a valid minimal shared configuration without requiring business repositories to be merged into the control-plane repository.

#### Scenario: Author initializes an empty directory
- **WHEN** a workspace author runs initialization in an empty directory and provides the required identity
- **THEN** Astrail creates a valid minimal workspace definition and reports the next authoring steps

### Requirement: Bootstrap prepares a developer instance non-destructively
The `astrail bootstrap` workflow SHALL resolve local state, inspect or obtain required repositories with explicit authorization, handle optional repositories separately, resolve capabilities, render the selected agent projection, and run health checks without overwriting existing repositories or user changes.

#### Scenario: Required repository already exists
- **WHEN** a managed Git destination already contains the expected repository
- **THEN** bootstrap preserves it and validates its identity instead of cloning over it

#### Scenario: Optional repository is unavailable
- **WHEN** an optional linked local repository is unavailable
- **THEN** bootstrap completes with that repository reported as unavailable but optional

### Requirement: Mutating lifecycle commands support preview
Bootstrap, synchronization, update, and lock-changing operations SHALL provide a dry-run or preview that reports intended changes before applying them.

#### Scenario: Update preview finds dependency changes
- **WHEN** newer compatible Distribution or capability versions are available
- **THEN** `astrail update --dry-run` reports version and generated-artifact changes without writing files

### Requirement: Validation, status, and doctor have stable machine output
Astrail SHALL provide human-readable output and stable structured output for configuration validation, resolved status, and health diagnostics, with documented exit codes and severity.

#### Scenario: Agent requests workspace status
- **WHEN** `astrail status --json` is called from the workspace root
- **THEN** it returns repositories, environments, capabilities, agent projection state, and diagnostics as structured data

### Requirement: Synchronization preserves user-owned content
The `astrail sync` workflow SHALL update only declared generated artifacts, symbolic links, or marked managed regions and MUST NOT replace unrelated user-owned content.

#### Scenario: AGENTS contains user-authored guidance
- **WHEN** synchronization updates an Astrail-managed instruction region
- **THEN** content outside that managed region remains byte-for-byte unchanged

### Requirement: Lifecycle operations are idempotent
Running initialization follow-up, bootstrap, synchronization, or doctor repeatedly against unchanged declared and local state SHALL not create additional changes or duplicate resources.

#### Scenario: Bootstrap runs twice
- **WHEN** bootstrap has completed successfully and no inputs have changed
- **THEN** a second bootstrap reports an already-satisfied state without recloning repositories or duplicating capability projections

### Requirement: Normal development does not require an Astrail execution wrapper
After bootstrap and synchronization, developers SHALL be able to open the workspace root in the supported agent and modify real child repositories through the agent's normal interaction model.

#### Scenario: Developer starts a cross-repository task in Codex
- **WHEN** the developer opens the Astrail workspace root and describes the task in natural language
- **THEN** Codex can discover the projected instructions and capabilities without the developer invoking the task through an `astrail run` wrapper

### Requirement: Update preserves reviewability and rollback information
Astrail SHALL record enough previous lock and generated-state information to explain an update and allow the user to restore the prior declared dependency resolution.

#### Scenario: Distribution update causes undesirable projection changes
- **WHEN** a user reviews an applied update and chooses to return to the prior lock state
- **THEN** Astrail can regenerate the prior projection without guessing previous dependency versions
