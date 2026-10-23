# astrail-target-codex

## 0.15.0

- Support typed shared configuration inputs through `extends.with`, explicit forwarding, binding inspection, and stale-input protection.
- Automatically maintain exact generated Skill paths in target-local `.gitignore` files while preserving user rules and source Skills.


## 0.14.0

### Minor Changes

- Support CodeBuddy IDE as an optional projection target alongside Codex, including initialization, workspace rules, Skills, target health, shared Git acquisition and setup resources, and transaction rollback. Retain the existing Codex API and ownership manifest; package the projection engine and built-in Skills once for both adapters.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - astrail-core@0.14.0
  - astrail-target-shared@0.14.0

## 0.13.1

### Patch Changes

- Updated dependencies
  - astrail-core@0.13.1

## 0.13.0

### Minor Changes

- Unify the workspace lifecycle around init, install and update. Install acquires missing resources, restores locked Git commits, synchronizes managed artifacts and automatically maintains the lock. Update refreshes remote configs and moving Git Skills, validates and synchronizes the resulting graph, and preserves the prior working cache, lock and projections if the operation fails. Existing business checkouts are never pulled or switched. Bootstrap remains an install compatibility alias; sync and lock retain their original scoped behavior.

### Patch Changes

- Updated dependencies
  - astrail-core@0.13.0

## 0.12.0

### Patch Changes

- Make workspace journals explain retained changes with readable summaries, safe diagnostic details, and nested step outcomes and durations. Preserve legacy record support, read-only/no-op behavior, redaction, and bounded retention.
- Updated dependencies
  - astrail-core@0.12.0

## 0.11.0

### Minor Changes

- Move documentation and task-record management out of the default Codex projection. Remove the bundled `astrail-records` Skill and its default `docs/` and `records/` guidance; users can opt into an independently maintained Skill through shared configuration.

  On synchronization, retire the recorded legacy Skill entry while preserving business documents and user-authored guidance. Refuse removal of modified copies or replaced links, including changes made after preview. No new guidance fields or automatic workflow hooks are introduced.

### Patch Changes

- astrail-core@0.11.0

## 0.10.0

### Minor Changes

- Support global and workspace-local CLI modes with workspace-local, shared workspace, and user-level preferences. Global initialization skips local dependencies; the launcher reads preferences before delegating to an installed CLI. Preserve version compatibility checks, report the selected runtime and executable, and copy built-in Skills in global mode so global upgrades cannot break their links.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - astrail-core@0.10.0

## 0.9.1

### Patch Changes

- Updated dependencies
  - astrail-core@0.9.1

## 0.9.0

### Minor Changes

- Keep config setup Skills in managed `.astrail/setups/` resources instead of the daily Skill list. Bootstrap now tells the Agent to complete setup within the original Workspace initialization request, in both JSON and human output. Migrate owned legacy projections, reuse verified Git copies without fetching, and preserve modified or unowned paths with diagnostics. Existing setup declarations remain valid; resource availability still does not mean setup or authentication has completed.

### Patch Changes

- astrail-core@0.9.0

## 0.8.0

### Minor Changes

- Replace Distribution manifests with shared configuration fragments and recursive `extends`. Support local files, HTTP URLs and Git refs/entry paths; merge partial business fields, preserve declaring paths and independent optional setup entries, and lock source digests and Git commits. Reject removed Distribution syntax. Setup Skills remain explicit Agent handoffs and are never executed by bootstrap.

### Patch Changes

- Updated dependencies
  - astrail-core@0.8.0

## 0.7.0

### Minor Changes

- Add HTTP(S) single-file Distribution sources for static hosting, with authorized bootstrap acquisition, offline inspection, bounded downloads, validation before caching, and URL-bound integrity locks. Add standard `setup.mode: skill` / `setup.mode: none` declarations and Agent handoff entries with absolute projected Skill paths. Legacy manifests without setup remain readable with an informational diagnostic. Bootstrap does not execute setup Skills or manage credentials.

### Patch Changes

- Updated dependencies
  - astrail-core@0.7.0

## 0.6.0

### Minor Changes

- Add default guidance and the built-in astrail-records Skill for repository-owned task records, handoffs, and reusable documentation. Preserve existing project conventions and keep records and docs user-owned during synchronization.

### Patch Changes

- astrail-core@0.6.0

## 0.5.0

### Minor Changes

- Record bounded, local-only workspace operation history with completed changes, failure outcomes, and configurable retention. Add human and JSON journal queries and on-demand history guidance in AGENTS.md and the inspection Skill.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - astrail-core@0.5.0

## 0.4.0

### Minor Changes

- Generate configurable multi-repository editor workspaces, preserve user JSONC settings and folders, and synchronize them during onboarding. Add agent-friendly open/list/sync commands for VS Code, Cursor, and CodeBuddy IDE, with a discoverable built-in editor Skill.

### Patch Changes

- Initialize Workspaces with a local Astrail tilde dependency, pinned package manager, and pnpm installation by default, with offline scaffolding via `--skip-install`. Preserve existing package metadata and package-manager choices, and report conflicts or installation failures explicitly.

  Delegate CLI execution to the Workspace-local version before command parsing. Honor workspace discovery, `--cwd`, and `--config`, preserve process behavior, and refuse global fallback when a declared local dependency is missing or incompatible.

  Add optional `requires.astrail` semver constraints to Workspace and Distribution manifests. Check the selected runtime against all source requirements before running commands or initializing over existing declarations, expose compatibility through doctor, and prevent incompatible bootstrap, lock, and projection writes. New workspaces declare a conservative minor-series compatibility range; legacy workspaces remain supported.
- Updated dependencies
- Updated dependencies
  - astrail-core@0.4.0

## 0.3.0

### Minor Changes

- Support per-repository environment branch targets via `checkout.branches` with an optional `checkout.branch` default. Extend interactive and JSON authoring, status, checkout previews, and the environment skill. Preserve shared-branch compatibility and reject conflicting targets for repositories sharing one physical checkout.

### Patch Changes

- Updated dependencies
  - astrail-core@0.3.0

## 0.2.0

### Minor Changes

- Complete repository addition with scoped preparation under one reviewed plan. Git repositories are cloned by default; use request `prepare: false` or CLI `--no-prepare` for declaration-only behavior. Preserve registration on clone failure and reuse identical declarations for retries. Interactive and Agent workflows offer selective Skill import after preparation without invoking workspace-wide bootstrap.

### Patch Changes

- Updated dependencies
  - astrail-core@0.2.0

## 0.1.2

### Patch Changes

- Carry repository descriptions through authoring, inspection, diagnostics, and Codex projection so
  humans and Agents can review each repository's responsibility before using it.
- Updated dependencies
  - astrail-core@0.1.2

## 0.1.1

### Patch Changes

- astrail-core@0.1.1
