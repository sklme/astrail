## Context

See `proposal.md` for motivation. `astrail-core` already resolves Capability declarations, and direct Git acquisition deliberately operates without a durable package or cache. Repository authoring established a safe request/plan/apply pattern, while the Codex target currently projects one built-in `astrail-repositories` Skill through hard-coded setup.

Skill authoring must reuse those boundaries: core owns normalization and manifest safety, the CLI owns terminal interaction, and the target package owns agent-facing instructions. Adding configuration must not silently cross the separate network and instruction-trust authorization boundary used by synchronization.

## Goals / Non-Goals

**Goals:**

- Provide one typed Skill-addition use case for terminal, JSON, and agent adapters.
- Keep `Capability(kind: skill)` as the only persisted model.
- Preserve YAML comments and unrelated user content through a targeted shared-manifest edit.
- Make preview authorization reusable without storing authoring sessions.
- Project a concise Codex Agent Skill that delegates decisions and mutation to the CLI contract.

**Non-Goals:**

- General Capability authoring for tools, Plugins, or context packs.
- Updating, removing, discovering, acquiring, or projecting Skills inside the add operation.
- Machine-local overlay authoring or arbitrary schema source types in the first version.
- Refactoring repository authoring into a generalized framework before a second concrete use case proves the shared abstractions.

## Decisions

### Expose `skill add` as a Capability authoring view

The user-facing command and Agent Skill use Skill terminology, but core normalizes every request into an ordinary Capability with `kind: skill`. No `skills` top-level manifest key or parallel identity model is introduced.

The alternative `capability add --kind skill` makes the underlying model explicit but burdens the common workflow with generic Capability concepts. The specialized command remains thin and can coexist with a future generic authoring surface.

### Mirror the repository request, plan, and apply contract

Core exposes typed Skill request, normalized addition, file change, plan, and apply result types. A deterministic plan identifier hashes the normalized declaration and exact before/after file digests. Apply holds the Workspace operation lock, rechecks the before digest, writes atomically, reloads the Workspace, verifies the expected resolved Skill, and restores the original on failure.

The implementation remains a focused service rather than immediately refactoring repository authoring. Small repeated hashing and YAML-editing helpers are preferable to destabilizing the already shipped repository workflow; a later change can extract common authoring primitives when both contracts are stable.

### Support three explicit source forms initially

The request accepts:

- `git`: URL, exactly one branch/tag/commit revision, and safe repository-relative Skill path;
- `workspace`: safe Workspace-relative path;
- `repository`: an existing repository identifier and safe path beneath it.

Local absolute paths require portable/shared and machine-local overlay semantics that the current local Capability schema does not support. Registry, Distribution, global, and builtin sources have different ownership or installation semantics. Rejecting them explicitly keeps this workflow coherent and leaves manual declarations compatible.

### Require identity and derive only presentation identifiers

Canonical identity is required because it is dependency and provenance state and cannot be inferred reliably from transport layout. When `id` or `exposeAs` is omitted, core derives it from the identity's final path segment and validates the result. Version remains optional with the schema's `*` behavior. Git instruction trust is never inferred; the request must explicitly set it when desired.

### Keep authoring and synchronization as separate authorization events

`skill add` only writes the declaration. It never clones, validates remote `SKILL.md`, writes a lock, or changes `.agents/skills`. The interactive CLI and Agent Skill may offer synchronization afterward only as a separately previewed operation. Machine apply requires `--yes --plan-id`; interactive apply confirms the in-memory plan.

This prevents a manifest-edit confirmation from implicitly authorizing network access or remote instructions.

### Generalize built-in Codex Skill projection as a small catalog

The target replaces the single hard-coded built-in repository Skill setup with a fixed catalog containing `astrail-repositories` and `astrail-skills`. Each entry uses the same projection strategy, ownership, integrity, and unowned-path refusal behavior. The new Skill contains only the machine-contract workflow and authorization boundaries; it does not duplicate source validation.

## Risks / Trade-offs

- [Two focused authoring services repeat small helpers] → Keep behavior explicit now and extract shared primitives only when their contracts converge.
- [Identity defaults may surprise users] → Require canonical identity and display every derived ID and alias in the preview.
- [A Git Skill is declared but not installed] → Return and document a clear follow-up; never merge declaration authorization with synchronization authorization.
- [Repository-backed path availability differs by machine] → Authoring validates the repository reference and safe path structurally; normal resolver and doctor diagnostics continue to report local availability.
- [A second always-projected built-in Skill changes target manifests] → Record it as target-owned and test idempotence, cleanup, and all projection strategies.

## Migration Plan

1. Add the core Skill authoring contract and focused tests without changing schemas.
2. Add the CLI human and machine adapters and process-level parity tests.
3. Add and validate the `astrail-skills` built-in Skill, then project both built-ins from a catalog.
4. Update documentation and run strict OpenSpec plus full Workspace verification.

The change is additive. Rolling back removes the built-in Agent Skill projection on the next synchronization and removes the command/API, while Skill declarations already added remain valid ordinary Capabilities.
