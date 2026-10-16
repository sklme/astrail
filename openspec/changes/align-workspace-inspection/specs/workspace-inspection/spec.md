## Purpose

Provide one portable, non-mutating view of declared and observed Workspace health so people, agents, and CI can inspect repositories, environments, capabilities, tools, and diagnostics consistently.

## ADDED Requirements

### Requirement: Workspace status aggregates persistent and observed state
Astrail SHALL return repositories, environments, configured environment checkout observations, capabilities, and diagnostics from one top-level status request. Structured status output SHALL retain the existing resolved Workspace fields while adding inspection state compatibly.

#### Scenario: Agent requests top-level status
- **WHEN** an agent invokes `astrail status --json`
- **THEN** the result includes resolved repositories and capabilities, every declared environment, checkout consistency for configured environments, target projection state, and diagnostics without prompting or mutation

#### Scenario: Resource-only environment is inspected
- **WHEN** an environment declares resources without repository checkout configuration
- **THEN** status identifies it as unconfigured for checkout and doctor does not treat that optional absence as unhealthy

### Requirement: Human status summarizes every primary inspection area
Human-readable status SHALL present concise sections for repositories, environments, capabilities, and target projection state rather than emitting only repositories or dumping the complete internal resolved object.

#### Scenario: Developer runs human status
- **WHEN** a developer invokes `astrail status`
- **THEN** the output contains deterministic summaries for all primary inspection areas and diagnostics remain rendered through the common diagnostic channel

### Requirement: Doctor reports configured environment inconsistency
Doctor SHALL inspect every environment with checkout configuration and SHALL report an advisory warning when its repositories are missing, not Git checkouts, on a different branch, or missing the desired local branch. Doctor SHALL NOT switch branches, fetch refs, or mutate repositories.

#### Scenario: Environment branch is inconsistent
- **WHEN** a configured environment contains a repository whose current branch differs from the desired branch
- **THEN** doctor reports an attributable warning with the environment, desired branch, affected repository status, and checkout remediation

#### Scenario: Strict environment diagnosis
- **WHEN** doctor runs with strict mode against the same inconsistent environment
- **THEN** the warning is returned as an error consistently in the structured diagnostic collection

### Requirement: Managed Git destinations are diagnosable
Astrail SHALL report an error when a present path declared as a managed Git source is not a Git checkout and SHALL report an advisory warning when its declared remote identity cannot be observed. It SHALL preserve the existing filesystem entry and SHALL NOT clone over it.

#### Scenario: Managed destination contains ordinary files
- **WHEN** `<workspace>/repos/<id>` exists for a Git source but is not a Git checkout
- **THEN** status and doctor report that bootstrap cannot safely materialize the repository there and identify a non-destructive remediation

### Requirement: Capability inspection uses resolved repository roots
Capability list and resolution commands SHALL resolve repository-backed Capability paths through the same Git, local, or subpath repository root used by Workspace resolution and SHALL not fall back to an unrelated Workspace-relative path.

#### Scenario: Imported Skill belongs to a subpath repository
- **WHEN** a Skill Capability references a path within a declared subpath repository
- **THEN** status, capability list, capability resolve, and projection planning agree on its absolute source path and availability

### Requirement: Runtime compatibility is part of doctor health
Doctor SHALL validate required local runtime tools and versions used by the installed Astrail release, SHALL expose observed versions without secrets, and SHALL provide a remediation when a required runtime is unavailable or unsupported.

#### Scenario: Node runtime is unsupported
- **WHEN** doctor observes a Node.js version outside Astrail's supported engine range
- **THEN** it returns an error identifying the supported range without executing mutations

### Requirement: Doctor reports unimported repository Skills informationally
Doctor SHALL perform read-only shallow Skill discovery over available declared repositories, SHALL return structured imported, unimported, importable, candidate, trust, conflict, and unavailable-repository state, and SHALL report unimported candidates as information rather than unhealthy state. Doctor SHALL NOT import, trust, synchronize, fetch, or persist discovery results.

#### Scenario: Repository owns undeclared Skills
- **WHEN** doctor finds a valid Skill candidate that has no matching Capability declaration
- **THEN** it returns the candidate and explicit discovery/import remediation without making ordinary or strict doctor fail solely for that finding

### Requirement: Inspection output is stable and severity-consistent
Status and doctor SHALL use the documented structured envelope, deterministic ordering, and documented exit behavior. Strict-mode escalation SHALL be applied once to the final diagnostic set without leaving contradictory severities in nested returned Workspace diagnostics.

#### Scenario: Strict JSON output contains a warning
- **WHEN** `astrail doctor --strict --json` encounters an advisory warning
- **THEN** the final diagnostics and nested Workspace diagnostic view represent it as an error and the command exits unsuccessfully

### Requirement: Supported agents discover Workspace inspection
Astrail SHALL expose status and doctor through target-native Agent guidance backed by the same structured CLI contracts used by people and CI. The guidance SHALL distinguish factual status from diagnostic doctor behavior, prefer JSON for Agent consumption, describe strict-mode escalation, and preserve the read-only inspection boundary.

#### Scenario: Agent needs current Workspace facts
- **WHEN** a synchronized supported agent needs repository, environment, capability, or projection state
- **THEN** it can discover an Astrail inspection capability that directs it to the structured status command without requiring the user to know the CLI syntax

#### Scenario: Agent diagnoses Workspace health
- **WHEN** a synchronized supported agent is asked to diagnose Workspace setup or drift
- **THEN** the same inspection capability directs it to structured doctor output, interprets diagnostics and remediation without applying changes, and uses strict mode only when warning-free health is required
