# Spec Delta

## Purpose

Enable users and agents to discover, synchronize, and open all available Astrail repository roots in a shared editor workspace while preserving personal editor configuration.

## ADDED Requirements

### Requirement: Configurable portable workspace

Astrail SHALL support `editor.workspaceFile` (default derived from `metadata.name`, then the root directory basename, finally `astrail.code-workspace`), `editor.default` (default `vscode`), and executable overrides through shared configuration and local overlays. The filename MUST be a root-level `.code-workspace` basename. Editor identifiers SHALL be `vscode`, `cursor`, and `codebuddy`.

#### Scenario: Local preferences
- **WHEN** local configuration overrides the shared workspace filename or editor
- **THEN** generation and opening use the effective values, visible through config inspection

#### Scenario: Unsafe filename
- **WHEN** a filename contains traversal or path separators
- **THEN** validation fails without writing outside the workspace

### Requirement: Repository projection preserves user content

The generated workspace SHALL contain available resolved repository directories, stable repository labels and relative paths where possible. Disabled and missing roots SHALL be omitted with missing roots reported. Identical physical paths and nested roots covered by another selected repository SHALL be deduplicated. Settings, tasks, launch, JSONC comments outside managed folder entries, and manually added folders MUST survive synchronization. Managed folder ownership SHALL be recorded locally; unknown existing folders MUST NOT be claimed or deleted. Malformed files and symlink destinations MUST be refused. Generated workspace and ownership records SHALL be excluded from Git by exact local artifact entries.

#### Scenario: Mixed topology
- **WHEN** repositories include Git, local overrides, duplicate paths, and subpaths
- **THEN** available outermost repository directories appear once and missing directories are reported

#### Scenario: User edits and repository removal
- **WHEN** a managed repository is removed while users added settings and an extra folder
- **THEN** its unchanged managed folder is removed and user content survives

#### Scenario: Invalid existing content
- **WHEN** the destination has invalid JSONC or is a symlink
- **THEN** synchronization returns a diagnostic and leaves existing content unchanged

### Requirement: Lifecycle synchronization without launching

Init, completed repository addition, bootstrap, and explicit editor sync SHALL synchronize the workspace. Dry-run SHALL write nothing and launch nothing. A synchronization failure after successful repository preparation SHALL report that partial outcome without undoing repository work.

#### Scenario: Repository onboarding
- **WHEN** a user adds and prepares a repository
- **THEN** the workspace includes it and the result advertises opening the workspace without launching an editor

#### Scenario: Declaration-only addition
- **WHEN** the newly declared repository is unavailable
- **THEN** available roots remain usable and the new repository is reported as skipped until preparation

### Requirement: Agent-friendly editor opening

`astrail open` SHALL synchronize and launch the selected or default IDE without prompts. `--dry-run` SHALL expose the planned file and launch actions. `--json` SHALL return the standard envelope with workspace path, selected editor, executable and arguments, synchronization and launch status, and stable diagnostics with remediation. Launching SHALL avoid shell interpolation, return promptly, and never substitute another editor. Launch failures SHALL preserve synchronized files. CodeBuddy opening MUST target the IDE rather than its terminal Agent.

#### Scenario: Successful request
- **WHEN** a user or agent explicitly requests opening with CodeBuddy
- **THEN** Astrail launches the CodeBuddy IDE with the synchronized workspace path

#### Scenario: Missing launcher
- **WHEN** the selected launcher is unavailable
- **THEN** the result reports failure and how to configure its executable while retaining the generated workspace

### Requirement: Discoverable editor capability

Astrail SHALL expose editor help and machine-readable discovery, project an `astrail-editor` Skill through the existing Codex target, advertise it in managed Agent guidance, and include onboarding next steps. The Skill SHALL describe sync, supported editors, configuration and JSON failure handling, and SHALL only launch on user intent to open an editor.

#### Scenario: Agent discovery
- **WHEN** the Codex projection is synchronized
- **THEN** the projected Skill and Agent guidance allow requests such as opening all repositories in CodeBuddy to discover `astrail open`
