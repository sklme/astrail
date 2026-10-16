## Context

See `proposal.md` for motivation. Environment resolution currently preserves only provider and redacted resources, while repository branches belong to individual Git sources and environment CLI commands are read-only. Repository and Skill authoring already establish the desired adapter pattern: core owns typed planning and safe apply, CLI owns terminal interaction, and a target-owned Agent Skill delegates through the CLI JSON contract.

The working tree also contains ongoing Skill-authoring changes in shared CLI and target files. Environment work must be additive and preserve that behavior.

## Goals / Non-Goals

**Goals:**

- Add one uniform branch to an explicit environment repository list without requiring environments in any Workspace.
- Reuse the proven plan-identifier and targeted-YAML authoring shape.
- Expose observation and local branch switching through core APIs shared by human and agent adapters.
- Preserve repository contents and require preview plus authorization before manifest or Git mutation.

**Non-Goals:**

- Remote Git mutation or network refresh.
- Deployment orchestration, immutable release composition, environment promotion, templates, or parallel checkout layouts.
- Per-repository branch exceptions or a generalized revision strategy.

## Decisions

### Extend Environment directly with repositories and checkout.branch

The shared schema adds optional `repositories: string[]` and `checkout: { branch: string }`. Existing resource-only environments and Workspaces with no environments stay valid. A checkout-enabled environment requires both fields through core cross-field validation, while resource-only environments require neither.

Tracks and repository sets were rejected for this iteration because they add indirection before reuse or promotion has been demonstrated. `checkout` remains an object rather than a scalar top-level branch so later revisions or layouts have a compatible namespace without affecting the current contract.

Repository `source.revision` remains unchanged. It controls ordinary initial clone behavior when no environment checkout is requested; an explicit environment checkout is an operation-scoped desired branch and does not rewrite repository declarations.

### Author environments through the existing plan/apply pattern

Core accepts a normalized addition request and edits only `environments.<id>` in `astrail.yaml`. Plans hash normalized intent plus exact before/after file content. Apply runs under the Workspace operation lock, checks current digests and the reviewed plan identifier, writes atomically, reloads the composed Workspace, and restores the original on failed verification.

Environment additions are portable shared declarations, so this iteration has no local-manifest target choice. Updating and removing existing environments remain separate future operations.

### Treat environment checkout as a separate mutation

Adding an environment never switches Git branches. Status and checkout planning resolve repository identities to physical Git top-level paths, group subpaths that share a physical checkout, and expose the logical identities on each physical action.

Planning observes only local state. It verifies the target under `refs/heads/<branch>` and never fetches or guesses a remote branch. Dirty state blocks only a required switch; a dirty checkout already on the desired branch remains observable but requires no mutation.

The checkout plan identifier hashes the environment declaration and physical observations. A second process invocation replans and applies only when its identifier matches the reviewed one. Apply rechecks the plan before the first switch, executes each physical action, and verifies final status. Multi-repository Git hosts offer no atomic transaction, so partial failure is returned precisely rather than hidden behind an atomicity claim.

### Keep interaction and agent guidance outside core

Commander.js and readline remain in `astrail`. `env add` supports an injectable interactive prompter and `--input <file|-> --dry-run --json`; `env status` is read-only; `env checkout` uses dry-run and `--yes --plan-id` apply semantics.

The target-owned `astrail-environments` Skill gathers intent and delegates to those JSON commands. It never edits YAML or invokes Git directly. Repository authoring receives an additive human next-step line, while the repository Agent Skill offers the environment workflow only as an optional follow-up.

### Record deferred scope only in the roadmap

Tracks, repository sets, snapshots, promotion, branch templates, automatic Feature-environment lifecycle, per-repository exceptions, worktrees, and deployment providers are listed as possible follow-ups without reserving schema or implementation abstractions now.

## Risks / Trade-offs

- [One environment branch may be too strict for some Workspaces] → Keep environments optional and defer explicit exception semantics until real demand appears.
- [Local-only branch checks require users to prepare branches themselves] → Return remediation and avoid implicit network access or branch creation.
- [A checkout can fail after another repository switched] → Preflight all roots, report completed actions exactly, and avoid promising atomicity.
- [Environment fields can conflict semantically when only one is supplied] → Reject incomplete checkout declarations through deterministic core diagnostics.
- [Concurrent authoring can overwrite newer YAML] → Bind apply to exact file digests and execute under the existing Workspace lock.

## Migration Plan

This change is additive. Existing manifests need no edits, and bootstrap behavior remains unchanged. Generated schema declarations and examples gain optional fields. Rollback removes the new commands, Skill projection, and optional environment checkout fields; repositories and their Git state are never deleted or reset.
