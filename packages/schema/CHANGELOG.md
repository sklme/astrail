# astrail-schema

## 0.10.0

### Minor Changes

- Support global and workspace-local CLI modes with workspace-local, shared workspace, and user-level preferences. Global initialization skips local dependencies; the launcher reads preferences before delegating to an installed CLI. Preserve version compatibility checks, report the selected runtime and executable, and copy built-in Skills in global mode so global upgrades cannot break their links.

## 0.9.1

### Patch Changes

- Derive the default editor workspace filename from metadata.name, then a usable workspace directory name, with astrail.code-workspace as the final fallback. Keep explicit editor.workspaceFile overrides and carry forward managed legacy workspace content without removing the old file.

## 0.9.0

## 0.8.0

### Minor Changes

- Replace Distribution manifests with shared configuration fragments and recursive `extends`. Support local files, HTTP URLs and Git refs/entry paths; merge partial business fields, preserve declaring paths and independent optional setup entries, and lock source digests and Git commits. Reject removed Distribution syntax. Setup Skills remain explicit Agent handoffs and are never executed by bootstrap.

## 0.7.0

### Minor Changes

- Add HTTP(S) single-file Distribution sources for static hosting, with authorized bootstrap acquisition, offline inspection, bounded downloads, validation before caching, and URL-bound integrity locks. Add standard `setup.mode: skill` / `setup.mode: none` declarations and Agent handoff entries with absolute projected Skill paths. Legacy manifests without setup remain readable with an informational diagnostic. Bootstrap does not execute setup Skills or manage credentials.

## 0.6.0

## 0.5.0

### Minor Changes

- Record bounded, local-only workspace operation history with completed changes, failure outcomes, and configurable retention. Add human and JSON journal queries and on-demand history guidance in AGENTS.md and the inspection Skill.

### Patch Changes

- Publish Schema resource metadata, move Schema URLs to sklme.github.io/astrail, and introduce an empty official template package. Move user documentation to the dedicated Astrail Pages site.

## 0.4.0

### Minor Changes

- Generate configurable multi-repository editor workspaces, preserve user JSONC settings and folders, and synchronize them during onboarding. Add agent-friendly open/list/sync commands for VS Code, Cursor, and CodeBuddy IDE, with a discoverable built-in editor Skill.
- Initialize Workspaces with a local Astrail tilde dependency, pinned package manager, and pnpm installation by default, with offline scaffolding via `--skip-install`. Preserve existing package metadata and package-manager choices, and report conflicts or installation failures explicitly.

  Delegate CLI execution to the Workspace-local version before command parsing. Honor workspace discovery, `--cwd`, and `--config`, preserve process behavior, and refuse global fallback when a declared local dependency is missing or incompatible.

  Add optional `requires.astrail` semver constraints to Workspace and Distribution manifests. Check the selected runtime against all source requirements before running commands or initializing over existing declarations, expose compatibility through doctor, and prevent incompatible bootstrap, lock, and projection writes. New workspaces declare a conservative minor-series compatibility range; legacy workspaces remain supported.

## 0.3.0

### Minor Changes

- Support per-repository environment branch targets via `checkout.branches` with an optional `checkout.branch` default. Extend interactive and JSON authoring, status, checkout previews, and the environment skill. Preserve shared-branch compatibility and reject conflicting targets for repositories sharing one physical checkout.

## 0.2.0

## 0.1.2

## 0.1.1
