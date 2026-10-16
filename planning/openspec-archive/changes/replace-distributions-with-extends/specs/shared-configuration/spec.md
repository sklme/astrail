## ADDED Requirements

### Requirement: Unified shared configuration
Astrail SHALL accept shared configuration fragments using the Workspace business fields and SHALL reject the removed Distribution format. Only Workspace entries SHALL require Workspace identity headers.

#### Scenario: Pure shared configuration
- **WHEN** a config contains policies but no identity, version, targets or setup
- **THEN** it is valid and contributes only its declared fields, with no missing-setup diagnostic

### Requirement: Recursive ordered references
Astrail SHALL load local, HTTP and Git extends recursively and deterministically, report cycles and incompatible Git refs, and retain provenance. Shared config metadata SHALL NOT replace Workspace identity.

#### Scenario: A team composes two configs
- **WHEN** a Workspace extends a team config which extends logging and deployment configs
- **THEN** dependency configs precede the team config, then Workspace/local overrides apply, and shared configs referenced more than once contribute once

#### Scenario: Source-relative resources
- **WHEN** a config in a Git subdirectory extends a sibling file or declares a file resource
- **THEN** paths resolve from that config while remaining within the acquired Git checkout

### Requirement: Offline inspection and verified acquisition
Astrail SHALL keep inspection and preview offline, and SHALL validate authorized remote acquisitions before publishing cache files. Locks SHALL record source coordinates, integrity and Git commits.

#### Scenario: Nested remote acquisition
- **WHEN** bootstrap discovers a remote dependency after obtaining its parent
- **THEN** it obtains the dependency during the same authorized bootstrap and resolves the resulting graph

#### Scenario: Invalid content or drift
- **WHEN** a source returns invalid YAML, an incompatible runtime requirement or bytes inconsistent with the lock
- **THEN** acquisition fails without publishing a usable partial cache and inspection reports the problem

### Requirement: Independent optional setup entries
Astrail SHALL collect each config's optional setup separately from merged configuration, dependencies before dependants, and SHALL NOT execute setup Skills.

#### Scenario: Multiple setup Skills
- **WHEN** two referenced configs provide setup and their parent omits setup
- **THEN** both entries remain visible with declaring source, effective alias and absolute Skill path

#### Scenario: Workspace setup
- **WHEN** a Workspace declares its own setup in addition to referenced configs
- **THEN** its entry follows the referenced entries and does not overwrite them
