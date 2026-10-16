## ADDED Requirements

### Requirement: Plugins execute only through an explicit permissioned lifecycle

Astrail SHALL describe executable Plugins with a versioned manifest, declared permissions, and lifecycle state, and SHALL keep a newly discovered Plugin inactive until the user explicitly accepts its permissions.

#### Scenario: A Distribution introduces a Plugin

- **WHEN** resolution discovers a Plugin that has not previously been accepted
- **THEN** Astrail reports its identity and requested permissions
- **AND** the Plugin remains inactive
- **AND** no Plugin code is loaded or executed

#### Scenario: A user accepts reviewed permissions

- **WHEN** the user explicitly accepts a compatible Plugin manifest and its requested permissions
- **THEN** Astrail records reviewable activation state
- **AND** the host exposes only the accepted permissions through the versioned Plugin API
