## 1. Portable Inspection Model

- [x] 1.1 Add additive Workspace status and batch environment status types/APIs that resolve once, preserve resource-only environments, and verify focused environment status tests pass.
- [x] 1.2 Add managed Git non-repository and missing-origin diagnostics plus Node engine compatibility checks, and verify resolver/lifecycle tests cover healthy, invalid, warning, and strict states.
- [x] 1.3 Make Capability inspection repository-root aware without changing authoring behavior, and verify repository and subpath-backed Capability CLI tests resolve the same paths as Workspace status.

## 2. Codex Projection Inspection

- [x] 2.1 Extend Codex projection health data with manifest presence, current state, and deterministic pending actions, and verify a synchronized projection reports current.
- [x] 2.2 Make projection doctor plan-first and report planning errors plus added, removed, changed, damaged, and unacquired artifacts without mutation; verify focused target tests cover each drift class.

## 3. CLI Aggregation and Presentation

- [x] 3.1 Aggregate portable and Codex state in top-level `status` JSON while preserving existing resolved fields, and verify CLI tests cover repositories, environments, capabilities, projection state, and diagnostics.
- [x] 3.2 Add concise human status and doctor renderers plus consistent immutable strict escalation and Workspace root metadata, and verify human/JSON/exit-code tests pass.

## 4. Documentation and Verification

- [x] 4.1 Document the expanded status/doctor contract, environment and projection health semantics, and non-mutating remediation boundaries; verify command examples match shipped behavior.
- [x] 4.2 Run formatting, boundaries, typecheck, focused and full tests, package build, and strict validation for `align-workspace-inspection` plus affected completed changes; fix all regressions before marking complete.

## 5. Agent Inspection Exposure

- [x] 5.1 Project an `astrail-inspection` built-in Codex Skill, mention status and doctor in managed Workspace guidance, and verify synchronization, discovery, manifest ownership, and drift checks cover the new artifact.
- [x] 5.2 Document the Agent workflow, run focused and full checks, and strictly validate the revised change before marking it complete again.
