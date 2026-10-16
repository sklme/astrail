## Purpose

Make Codex projection health reflect the complete expected-versus-current target state, including newly declared, changed, removed, damaged, or not-yet-acquired Skill artifacts.

## ADDED Requirements

### Requirement: Projection status compares expected and current state
The Codex target SHALL derive expected artifacts from the resolved Workspace, compare them with the recorded projection manifest and filesystem, and return whether the projection is current plus deterministic pending synchronization actions.

#### Scenario: Projection is current
- **WHEN** the manifest, managed instruction region, projected Skills, ownership, sources, and integrity match the resolved Workspace
- **THEN** projection status reports current state with no pending actions or drift diagnostics

#### Scenario: Skill was imported after synchronization
- **WHEN** a repository-backed Skill Capability is added after the previous successful synchronization
- **THEN** projection status reports a pending projection action and doctor warns that synchronization is required

#### Scenario: Capability was removed after synchronization
- **WHEN** a previously projected Capability is no longer in resolved Workspace state
- **THEN** projection status reports the obsolete recorded artifact through a pending synchronization action without deleting it during inspection

### Requirement: Projection doctor includes planning diagnostics
Projection doctor SHALL include target planning diagnostics even when the projection manifest is absent or stale, so alias conflicts, unavailable built-in sources, unavailable Skill sources, and changed Git acquisition requests cannot be hidden by an early return.

#### Scenario: Missing manifest and invalid target plan
- **WHEN** no projection manifest exists and the resolved Workspace also produces a target planning error
- **THEN** doctor reports both the missing manifest and the planning error

#### Scenario: Git Skill request changed
- **WHEN** a direct Git Skill's URL, revision, content path, locked integrity, or exposed identity no longer matches its recorded acquisition
- **THEN** doctor reports target drift and a reviewed synchronization remediation without fetching remote content

### Requirement: Projection inspection preserves ownership and authorization boundaries
Projection status and doctor SHALL be read-only, SHALL use recorded ownership to describe drift, and SHALL NOT repair, remove, acquire, or replace projected artifacts. Git Capability acquisition SHALL continue to require a separately reviewed and explicitly authorized synchronization.

#### Scenario: Drift is inspected
- **WHEN** doctor finds a stale or modified projected Skill
- **THEN** it reports the affected path, identity, and safe next action while leaving user-owned and target-owned files unchanged

### Requirement: Top-level status exposes target projection state
The CLI SHALL include Codex projection health in top-level human and structured status results while keeping Codex-specific semantics outside the portable core Workspace model.

#### Scenario: Agent inspects Workspace status
- **WHEN** `astrail status --json` runs for a Codex-targeted Workspace
- **THEN** its data contains a Codex projection section with manifest presence, current state, recorded artifacts, and pending actions

### Requirement: Codex projects Agent-native inspection guidance
The Codex target SHALL project a built-in Astrail inspection Skill and SHALL mention status and doctor in its managed Workspace guidance. The Skill SHALL be tracked like other built-in projection artifacts so missing, stale, or damaged inspection guidance is visible through projection health.

#### Scenario: Codex projection is synchronized
- **WHEN** Astrail synchronizes a Codex-targeted Workspace
- **THEN** Codex can discover an `astrail-inspection` Skill that explains structured status and doctor usage, diagnostic handling, and non-mutating remediation boundaries
