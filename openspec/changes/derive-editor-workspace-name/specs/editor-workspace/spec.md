# Spec Delta

## ADDED Requirements

### Requirement: Workspace-specific default filename

Astrail SHALL support `editor.workspaceFile`, `editor.default` (default `vscode`), and executable overrides through shared configuration and local overlays. The filename MUST be a root-level `.code-workspace` basename. Editor identifiers SHALL be `vscode`, `cursor`, and `codebuddy`. When `editor.workspaceFile` is omitted, Astrail SHALL use the first usable filename stem from `metadata.name` and the Workspace root directory basename, then fall back to `astrail`. Explicit filenames SHALL retain priority and validation. `metadata.displayName` SHALL NOT affect filenames, and fallback naming SHALL NOT bypass manifest validation.

#### Scenario: Named workspace
- **WHEN** a Workspace has `metadata.name: hypha` and no explicit filename
- **THEN** sync and open use `hypha.code-workspace`

#### Scenario: Fallback names
- **WHEN** the planner has no usable metadata name
- **THEN** it uses the usable root directory basename or finally `astrail.code-workspace`

#### Scenario: Local preferences
- **WHEN** local configuration overrides the shared workspace filename or editor
- **THEN** generation and opening use the effective values, visible through config inspection

#### Scenario: Unsafe explicit filename
- **WHEN** an explicit filename contains traversal or path separators
- **THEN** validation fails without falling back or writing outside the workspace

### Requirement: Managed legacy content preservation

When creating an inferred default file, Astrail SHALL inherit JSONC content and managed folder ownership from a tracked legacy `astrail.code-workspace` if the destination is absent. It SHALL reconcile owned folders, preserve user content, retain the legacy file unchanged, and honor existing destination content. Dry-run SHALL write nothing. Unsafe, malformed, or stale legacy sources MUST be refused.

#### Scenario: Upgrade from the old default
- **WHEN** the new inferred destination is absent and ownership state tracks the legacy file
- **THEN** settings, tasks, launch configuration, comments, and manual folders survive in the new file while obsolete owned folders are removed and the legacy file remains unchanged

#### Scenario: Existing named workspace
- **WHEN** the inferred destination already exists
- **THEN** synchronization uses that file and does not replace its content from the legacy file

#### Scenario: Legacy source changes after preview
- **WHEN** a migration source changes after planning
- **THEN** application reports a stale plan and does not write the new workspace
