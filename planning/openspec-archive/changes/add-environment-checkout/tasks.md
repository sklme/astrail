## 1. Workspace Model and Resolution

- [x] 1.1 Extend the Workspace schema and generated declarations with optional environment repositories and checkout branch fields, and verify schema generation plus optional/resource-only fixtures pass.
- [x] 1.2 Resolve environment membership and desired branch with unknown-repository and incomplete-checkout diagnostics, and verify focused resolver tests preserve no-environment repository behavior.

## 2. Core Environment Workflows

- [x] 2.1 Implement typed environment-addition planning and safe authorized apply with targeted YAML edits, plan identifiers, stale detection, rollback, and composed verification; verify focused core authoring tests.
- [x] 2.2 Implement read-only environment consistency status and physical Git-root deduplication; verify matching, mismatched, missing, resource-only, local, and subpath cases.
- [x] 2.3 Implement checkout planning and authorized apply with local-branch, dirty-state, stale-plan, no-op, partial-failure, and final verification behavior; verify no test performs network or remote mutation.

## 3. CLI and Agent Adapters

- [x] 3.1 Add `env add` interactive and JSON dry-run/apply flows backed by core, and verify adapter parity, cancellation, structured diagnostics, and stale plan refusal.
- [x] 3.2 Add human and JSON `env status` plus previewed `env checkout` commands, and verify explicit authorization and plan identifiers are required for mutation.
- [x] 3.3 Add the optional environment follow-up to human and Agent repository authoring without changing repository plans or materialization, and verify the hint is present.
- [x] 3.4 Add and project the target-owned `astrail-environments` Skill, and verify its authoring and checkout guidance uses only structured Astrail contracts with separate confirmations.

## 4. Documentation, Roadmap, and Verification

- [x] 4.1 Document optional environment configuration, CLI and Agent workflows, default repository behavior, and local-only safety boundaries; verify every public command has an example.
- [x] 4.2 Add Tracks, repository sets, snapshots, promotion, templates, automatic Feature-environment lifecycle, per-repository exceptions, worktrees, and deployment providers to the roadmap without implementing them.
- [x] 4.3 Run schema generation, formatting, lint, boundary checks, typecheck, focused and full tests, build, and strict OpenSpec validation; fix scoped regressions and mark all tasks complete.
