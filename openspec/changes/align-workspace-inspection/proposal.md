## Why

Astrail's repository topology, Skill Capability, and environment workflows now expose richer persistent and observed state, but the top-level `status`, `doctor`, and related inspection commands still report the narrower foundation-era view. This leaves environment inconsistency, repository-backed Skill paths, and stale Codex projections invisible or misleading precisely when users rely on one health command after authoring or synchronization.

## What Changes

- Add a portable Workspace inspection result that keeps existing resolved fields while aggregating configured environment checkout observations and health facts.
- Extend top-level `status` human and JSON output to include repositories, environments, capabilities, and target projection state without prompting or mutating the Workspace.
- Extend `doctor` to diagnose invalid managed Git destinations, inconsistent configured environments, unsupported local runtime versions, and target projection drift with stable severities and remediation.
- Compare the expected Codex projection with its recorded and filesystem state so newly added, changed, removed, or unacquired Skills are diagnosable before synchronization.
- Fix Capability inspection so repository-backed Skills resolve through declared Git, local, and subpath repository roots rather than a Workspace-relative fallback.
- Add concise human renderers while retaining the structured envelope and existing resolved status fields for alpha compatibility.
- Expose status and doctor to supported agents through a projected built-in inspection Skill and managed target guidance backed by the same structured CLI contracts.
- Add end-to-end tests and documentation for healthy, stale, strict, and partially configured inspection states.
- Non-goals: changing authoring authorization, automatically synchronizing projections, automatically switching environment branches, fetching repositories, or persisting ephemeral Skill discovery results.

## Capabilities

### New Capabilities

- `workspace-inspection`: Portable status and health aggregation for repositories, configured environments, capabilities, tools, diagnostics, and stable human/machine presentation.
- `codex-projection-inspection`: Target-specific expected-versus-current Codex projection state and actionable drift diagnostics.

### Modified Capabilities

None. The foundation and follow-up changes have not been archived into main specs, so this change introduces focused inspection contracts as new deltas.

## Impact

- `astrail-core` public status/doctor result types, repository diagnostics, environment observation APIs, and Capability inspection inputs.
- Doctor adds structured informational inventory for repository Skills that are discoverable but not yet imported, without treating them as unhealthy or mutating configuration.
- `astrail-target-codex` projection health state, diagnostics, managed guidance, and built-in inspection Skill.
- `astrail status`, `astrail doctor`, `capability list`, and `capability resolve` human and JSON behavior.
- CLI/core/target tests, lifecycle and inspection documentation, and OpenSpec validation.
- No network dependency, company-specific behavior, or mutation is added to inspection commands or Agent-facing inspection guidance.
