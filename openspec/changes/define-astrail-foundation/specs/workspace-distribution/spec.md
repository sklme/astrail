## Purpose

Allow organizations and communities to publish reusable Astrail workspace specializations as declarative compositions while keeping proprietary resources and executable extensions outside the open-source core.

## ADDED Requirements

### Requirement: Distributions are reusable declarative packages
A Workspace Distribution SHALL be able to contribute manifest defaults, repository metadata conventions, context packs, capability requirements and recommendations, advisory policies, and plugin requirements without containing a complete local workspace instance.

#### Scenario: Company backend Distribution is consumed
- **WHEN** a project extends a company backend Distribution
- **THEN** the project inherits declared defaults and recommendations while retaining its own repository and environment identities

### Requirement: Distribution composition is deterministic
Astrail SHALL define ordered composition and override rules for multiple Distributions and SHALL report conflicts that cannot be resolved without project intent.

#### Scenario: Project overrides a Distribution default
- **WHEN** a project manifest explicitly overrides an overridable Distribution value
- **THEN** the project value wins and the resolved explanation records both the source default and override

#### Scenario: Two Distributions declare incompatible required capabilities
- **WHEN** selected Distributions require mutually incompatible capability versions
- **THEN** resolution fails with a dependency conflict that identifies both sources

### Requirement: Declarative Distributions and executable Plugins are distinct
Astrail SHALL treat configuration and resource collections as Distributions or context packs, and SHALL reserve Plugins for executable extensions to engine providers, validators, operations, targets, or other explicit extension points.

#### Scenario: Bundle contains only context and Skill recommendations
- **WHEN** a package contains no executable engine extension
- **THEN** it can be consumed as a Distribution without Plugin execution permissions

### Requirement: Company-specific behavior remains outside the core
The open-source Astrail core MUST NOT require company-specific Git hosts, authentication, environment systems, log systems, repository names, or capability registries.

#### Scenario: Internal environment provider is required
- **WHEN** a company Distribution requires an internal environment provider
- **THEN** it declares an external Plugin dependency rather than modifying Astrail core semantics

### Requirement: Distribution dependencies are versioned and lockable
Astrail SHALL resolve Distribution identity, version, source, transitive declarative dependencies, and integrity metadata into lock state.

#### Scenario: Workspace is reproduced from a lock file
- **WHEN** the same Distribution sources and locked artifacts remain available
- **THEN** Astrail resolves the same Distribution dependency graph

### Requirement: Executable extensions require explicit trust
Astrail MUST NOT execute a Plugin contributed by a Distribution until its identity, source, requested permissions, and trust decision are visible to the user or an applicable declared policy.

#### Scenario: Distribution introduces a new executable Plugin
- **WHEN** an update adds a Plugin that was not previously trusted
- **THEN** update preview reports the Plugin and requested permissions and leaves it inactive until explicitly accepted
