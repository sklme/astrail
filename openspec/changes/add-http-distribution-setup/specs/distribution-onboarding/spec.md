## ADDED Requirements

### Requirement: HTTP single-file Distributions

Astrail SHALL accept an HTTP(S) Distribution manifest source and acquire it only through explicitly authorized bootstrap.

#### Scenario: Offline preview and inspection

- **WHEN** a Workspace references an uncached HTTP Distribution
- **THEN** status and bootstrap preview report its missing state and acquisition action without network or filesystem mutation

#### Scenario: Validated acquisition

- **WHEN** authorized bootstrap receives a valid single-file manifest
- **THEN** it atomically caches it, composes its declarations, and prepares declared Skills
- **AND** repeated bootstrap reuses that cached content

#### Scenario: Invalid response

- **WHEN** the response is unsuccessful, oversized, invalid YAML/schema, identity/version incompatible, or violates single-file constraints
- **THEN** bootstrap reports an error and does not publish the manifest to the cache

#### Scenario: Pinned content

- **WHEN** an HTTP manifest differs from its explicit integrity or matching lock digest
- **THEN** Astrail diagnoses the mismatch and prevents acquisition/projection from proceeding

### Requirement: Standard Distribution setup

A Distribution SHALL declare a setup Skill by canonical identity or explicitly declare no additional setup; older manifests without a setup section SHALL remain readable with an informational diagnostic.

#### Scenario: Skill handoff

- **WHEN** bootstrap projects a declared and active setup Skill
- **THEN** human and JSON results identify the Distribution, effective alias, and absolute SKILL.md path
- **AND** the result describes an available setup entry rather than completed setup
- **AND** the CLI does not execute the Skill

#### Scenario: Unavailable entry

- **WHEN** a setup identity is missing, disabled, or not a Skill
- **THEN** Astrail diagnoses the reference and does not claim the setup entry is available

#### Scenario: No extra setup

- **WHEN** a Distribution declares `mode: none`
- **THEN** bootstrap reports that no additional setup is declared without requiring an empty Skill
