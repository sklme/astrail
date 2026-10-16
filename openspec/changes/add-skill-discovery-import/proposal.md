## Why

Many declared business repositories already own useful Agent Skills, but Astrail only exposes them after users manually know each path and add each Capability. Astrail needs a reviewed discovery and selective-import workflow so existing repository Skills can be reused at the Workspace layer without implicitly activating every instruction found in child repositories.

## What Changes

- Add portable, read-only Skill discovery across selected or all locally available declared repositories using explicit supported directory conventions.
- Return deterministic candidates with repository ownership, relative source path, metadata, proposed identity and alias, existing-Capability state, trust state, and conflicts; discovery never mutates manifests or `.agents/skills`.
- Add a selective batch-import contract that converts chosen candidates into ordinary `kind: skill` Capability declarations, previews one deterministic atomic plan, preserves unrelated YAML, and applies only after explicit authorization.
- Add `astrail skill discover` for human-readable and JSON inventory, plus `astrail skill import` for interactive selection and machine-readable preview/apply.
- Surface compact, structured unimported-Skill inventory after `repo add` and during `bootstrap`/`doctor`; add a human-only `repo add --import-skills` continuation while keeping Agent selection and plan authorization machine-readable and explicit.
- Extend the target-owned `astrail-skills` Agent Skill so conversation can discover candidates, ask the user which Skills to expose, invoke the same batch-import contract, and keep synchronization as a separate authorization event.
- Keep Capability as the only persisted domain object. Discovery results are ephemeral and introduce no package, cache, repository, inventory, or Skill-specific manifest layer.
- Non-goals: automatically activating discovered Skills, scanning undeclared or unavailable repositories, fetching remote content during discovery, watching repositories for changes, or implicitly trusting repository instructions.

## Capabilities

### New Capabilities

- `skill-discovery`: Deterministic repository Skill discovery and selective, previewed batch import into ordinary Capability declarations.
- `skill-discovery-skill`: Agent conversation guidance for discovering repository Skills, collecting a selection, and invoking the shared import contract safely.

### Modified Capabilities

- None. Existing Skill authoring, Capability resolution, repository topology, trust, and synchronization contracts are consumed without changing their persisted models.

## Impact

- `astrail-core` gains repository Skill scanning, candidate/conflict modeling, batch import planning, stale-plan detection, atomic targeted YAML mutation, and composed verification.
- `astrail` gains `skill discover` and `skill import` human and JSON workflows, including interactive multi-selection.
- Repository authoring, bootstrap, and doctor gain additive candidate counts, metadata, diagnostics, and safe next-step guidance without implicit import.
- `astrail-target-codex` updates the built-in `astrail-skills` instructions to drive the same CLI contracts.
- Tests cover repository selection, conventions, deterministic ordering, malformed or duplicate candidates, trust visibility, selective import, conflicts, stale plans, CLI/agent parity, and no-mutation discovery.
- Documentation explains how child-repository Skills become explicitly exposed at the Workspace layer.
