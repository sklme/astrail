## Purpose

Resolve portable agent capabilities from multiple sources while separating package identity from user-facing invocation and making dependencies, recommendations, conflicts, and provenance visible.

## ADDED Requirements

### Requirement: Package identity and exposed capability name are separate
Astrail SHALL assign each capability a stable source identity and version while allowing the workspace to expose a short, agent-compatible name that users can invoke without knowing the package namespace or filesystem path.

#### Scenario: Company Skill is exposed with a short name
- **WHEN** `example/loghelper@^2` is resolved with `exposeAs: loghelper`
- **THEN** the agent discovers `loghelper` and the user can request it without mentioning `company` or its installation directory

### Requirement: Capability sources are explicit and traceable
Astrail SHALL resolve capabilities from declared built-in, workspace, child-repository, global, distribution, registry, or plugin sources and SHALL retain the winning source and version in resolved state.

#### Scenario: Child repository exports a Skill
- **WHEN** a child repository whose instructions are trusted exports a Skill selected by the workspace
- **THEN** Astrail exposes the Skill without copying its canonical content into a second authoritative source

### Requirement: Dependency modes have distinct behavior
Astrail SHALL support `required`, `peer`, `recommended`, `optional`, and `conflicts` dependency semantics for capabilities.

#### Scenario: Required capability is unavailable
- **WHEN** a required capability cannot be resolved
- **THEN** validation reports an error and identifies the requesting workspace or capability

#### Scenario: Recommended capability is unavailable
- **WHEN** a recommended capability cannot be resolved
- **THEN** Astrail reports a recommendation without automatically installing it or making the workspace invalid

#### Scenario: Peer capability is provided by the host
- **WHEN** a capability declares a compatible peer requirement and the workspace already provides it
- **THEN** resolution reuses the host capability rather than installing another copy

### Requirement: Exposed names are unique
Astrail SHALL reject an ambiguous resolved view in which multiple capabilities expose the same agent-visible name unless the workspace explicitly aliases or selects one.

#### Scenario: Two registries provide loghelper
- **WHEN** two selected packages both request the exposed name `loghelper`
- **THEN** resolution reports a conflict and suggests explicit `exposeAs` aliases

### Requirement: Recommendations are deterministic and inspectable
Capability recommendations SHALL originate from declared distributions, repository metadata, context packs, or plugins and MUST NOT be presented as required solely because an agent inferred that they might be useful.

#### Scenario: Backend distribution recommends log diagnostics
- **WHEN** a workspace uses a backend distribution that recommends a logging Skill
- **THEN** Astrail reports the recommendation, its source, compatibility range, and installation state

### Requirement: Resolved capability versions are lockable
Astrail SHALL be able to record resolved capability identities, versions, source locations, and integrity metadata in lock state without embedding executable content or credentials.

#### Scenario: Capability source changes after locking
- **WHEN** a later resolution produces content inconsistent with locked integrity metadata
- **THEN** Astrail reports drift before synchronization

### Requirement: Agent projections are derived artifacts
Astrail SHALL treat agent-facing Skill directories and configuration as projections of resolved capabilities, not as additional canonical package copies.

#### Scenario: Codex projection is regenerated
- **WHEN** the locked Skill version changes and synchronization runs
- **THEN** the Codex-visible projection updates while the package identity and provenance remain traceable
