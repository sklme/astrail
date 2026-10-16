# Proposal

## Why

Astrail users need one editor window for repositories spread across managed checkouts, local paths, and logical subpaths. Agents also need to discover and invoke this workflow without interactive prompts.

## What Changes

- Generate a configurable root-level `.code-workspace` from the resolved repository topology; synchronize after init, repo add, bootstrap, and explicit sync.
- Preserve user settings and manually added folders; use local generated artifacts excluded from Git.
- Add noninteractive `open` with VS Code, Cursor, and CodeBuddy IDE adapters, dry-run and structured results, configurable defaults and local executable overrides.
- Project an `astrail-editor` Skill, advertise it in Agent guidance, expose editor command discovery, and add onboarding next steps.
- Non-goals: environment-specific views, editor plugins, repository branch/worktree creation, automatic IDE launches during onboarding, and new agent projection targets. Editor workspace support remains portable; no company service is required.

## Capabilities

### New Capabilities

- `editor-workspace`: configuration, generation, lifecycle synchronization, editor launching, and agent discovery.

### Modified Capabilities

None.

## Impact

Schema and generated types/docs; portable core workspace planner/writer; CLI lifecycle and launch adapters; Codex built-in Skill and managed guidance; tests and user documentation. JSONC parsing/editing is needed to preserve user workspace content.
