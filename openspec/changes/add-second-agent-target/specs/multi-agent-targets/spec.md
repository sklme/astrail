## ADDED Requirements

### Requirement: Astrail projects resolved state into a second native agent format

Astrail SHALL implement a second agent target from the shared resolved Workspace while preserving target-native discovery, ownership, and health-check semantics.

#### Scenario: A Workspace enables two targets

- **WHEN** a Workspace selects Codex and the supported second target
- **THEN** each target receives a projection derived from the same resolved state
- **AND** each target updates only artifacts it owns

#### Scenario: Common target behavior is extracted

- **WHEN** both target implementations demonstrate equivalent lifecycle behavior
- **THEN** Astrail may expose that behavior through a shared target contract
- **AND** product-specific behavior remains in the target package
