## Context

See `proposal.md` for motivation. Core resolution already observes repository presence and Git facts, while environment checkout observation and Codex projection planning live in separate services. Top-level status currently returns the raw resolved Workspace, top-level doctor adds only Git executable and recorded-artifact checks, and Capability CLI commands perform a second resolution without repository roots.

Inspection must remain read-only, deterministic, secret-safe, and portable. Target-specific state must not leak into `astrail-core`, existing structured status fields should remain available during the alpha, and user-owned repositories and projection paths must never be repaired implicitly.

## Goals / Non-Goals

**Goals:**

- Reuse one resolved repository/capability view across status, doctor, and related inspection commands.
- Aggregate environment checkout observations without changing branch state.
- Make target health a comparison of expected, recorded, and filesystem state.
- Preserve stable diagnostic codes, deterministic output, target ownership, and strict-mode semantics.
- Add useful human summaries without weakening machine output.

**Non-Goals:**

- Creating a generic plugin health framework or a new background health daemon.
- Fetching remote branches or Git Capability content during inspection.
- Making environment branch selection mandatory.
- Persisting status snapshots or Skill discovery inventories.
- Changing authoring, checkout, bootstrap, or synchronization authorization.

## Decisions

### 1. Extend resolved status additively with environment observations

Core will expose a `WorkspaceStatus` shape that retains the current `ResolvedWorkspace` fields and adds deterministically ordered `environmentStatuses`. A batch environment observation API will resolve the Workspace once and reuse the same repository roots for all environments. Resource-only environments remain visible with `configured: false`; doctor evaluates only configured checkout environments.

Returning a completely new compact data shape was considered but rejected for this change because the structured envelope is documented as stable and existing agents may already consume `topology`, `capabilities`, or provenance. Human rendering can be compact independently of machine compatibility.

### 2. Keep status factual and doctor diagnostic

Environment status records `consistent`, per-repository state, branch existence, and physical checkout identity. Top-level status returns those facts without converting every mismatch into command failure. Doctor maps configured inconsistency to an advisory warning; strict mode promotes the final warning set to errors.

Making ordinary branch drift an unconditional error in status was rejected because environments are optional coordination intent and status must remain useful while developers intentionally move between branches.

### 3. Treat invalid managed Git destinations as resolution errors

A present path declared with `source.type: git` must be a Git checkout. Otherwise bootstrap cannot clone safely and remote identity cannot be checked, so resolution emits an error with non-destructive remediation. A Git checkout with no observable origin remains usable but receives a warning because declared identity cannot be verified.

Silently treating the directory as a linked local repository was rejected because it changes ownership semantics and bypasses the author's explicit source declaration.

### 4. Reuse repository-aware Capability resolution

CLI Capability inspection will either consume the already resolved Capability list or pass the exact resolved repository path map when recommendation calculation requires a second pass. It will never invoke repository-backed resolution with an empty path map. This keeps imported Skills and monorepo subpath Skills consistent with projection planning.

Adding a second repository path fallback inside Capability resolution was rejected because it would hide incorrect callers and cannot reconstruct derived subpath topology safely from Capability data alone.

### 5. Make Codex health plan-first

`doctorCodexProjection` will always build the expected projection plan before evaluating manifest state. Its result will expose manifest presence, recorded artifacts, `current`, and pending change actions. Planning diagnostics are included even when the manifest is absent. When a manifest exists and target actions remain, one drift warning summarizes the pending actions while existing artifact-specific diagnostics continue to identify missing, broken, or modified paths.

Reimplementing artifact comparison separately in doctor was rejected because `planCodexProjection` already owns acquisition request matching, strategy-specific ownership, alias checks, source integrity, and manifest equality.

### 6. Aggregate target state in the CLI adapter

Portable core status will not import Codex types. The CLI will combine `WorkspaceStatus` with `doctorCodexProjection` for top-level status and doctor, preserving the target boundary. Target inspection remains read-only even though it returns the same action descriptions used by synchronization preview.

Embedding Codex state in `ResolvedWorkspace` was rejected because it would make future targets alter portable core semantics.

### 7. Escalate diagnostics immutably and once

Strict handling will clone warning diagnostics into errors after portable and target diagnostics have been combined. Core doctor will also return a nested Workspace diagnostic view with matching severities. This avoids mutating shared resolver objects and contradictory JSON.

### 8. Keep doctor human output as a summary

Human doctor output will show root, tool versions, repository/environment/capability counts, and target current/pending state; detailed problems continue through the common diagnostic renderer. JSON continues to carry full attributed data.

### 9. Project one Agent-native inspection Skill

The Codex target will project an `astrail-inspection` built-in Skill alongside the existing repository, environment, and Skill-authoring capabilities. Its instructions call the public structured `status` and `doctor` commands rather than duplicating resolution or diagnosis logic. The managed `AGENTS.md` region will mention both commands so basic discovery does not depend solely on Skill triggering, while the Skill carries the detailed selection, interpretation, strict-mode, and read-only guidance.

Embedding a status snapshot in generated instructions was rejected because observations become stale. Adding target-only diagnostic handlers was rejected because CLI, Agent, and future MCP consumers must share Core and target result contracts.

### 10. Report unimported repository Skills without changing health

Doctor performs the existing shallow, read-only discovery over available declared repositories and returns a compact `repositorySkills` inventory. Discoverable but undeclared candidates produce an informational diagnostic with paths, trust, conflicts, and explicit import remediation. Strict mode does not promote information to an error, and doctor never imports or synchronizes a candidate.

## Risks / Trade-offs

- [Batch environment observation adds Git calls] → Resolve once, deduplicate physical checkouts within each environment, preserve deterministic ordering, and avoid network operations.
- [Additive status data increases JSON size] → Preserve compatibility now and keep human output concise; a future versioned status schema can intentionally remove raw internal fields.
- [One projection drift warning may accompany artifact-specific warnings] → Use unique diagnostic codes and keep the summary actionable rather than duplicating individual messages.
- [A managed Git directory error affects bootstrap as well as doctor] → This is intentional because bootstrap cannot safely overwrite it; remediation remains explicitly non-destructive.
- [Target planning hashes Skill sources during status] → Reuse existing projection planning behavior and avoid remote acquisition; large-source optimization can be addressed separately if profiling shows a need.
- [Agent guidance can drift from command behavior] → Keep commands canonical, test the projected Skill's required invocations and safety language, and include it in ordinary projection integrity checks.

## Migration Plan

1. Add core status/environment types and diagnostics while preserving existing resolved fields.
2. Add plan-first Codex projection health data and drift diagnostics.
3. Aggregate target state and add human renderers in the CLI; fix repository-aware Capability inspection.
4. Add focused and end-to-end tests plus public documentation, then validate all affected OpenSpec changes and the full monorepo.
5. Project built-in Agent inspection guidance for status and doctor, then verify discovery and integrity through the existing Codex projection lifecycle.

Rollback removes the additive status fields and new diagnostics/renderers. Inspection performs no mutation, so rollback requires no repository, environment, lock, or projection data migration.
