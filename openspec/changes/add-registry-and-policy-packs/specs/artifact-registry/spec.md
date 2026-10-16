## ADDED Requirements

### Requirement: Registries provide verifiable artifact discovery

Astrail SHALL discover compatible Distribution, capability, and Plugin metadata from configured registries and SHALL report publisher identity, version compatibility, integrity, and signature status before installation.

#### Scenario: A compatible artifact is discovered

- **WHEN** registry metadata matches the requested identity and compatibility constraints
- **THEN** Astrail reports the candidate with source and verification metadata
- **AND** Astrail does not install it automatically

#### Scenario: Verification fails

- **WHEN** an artifact fails an integrity or required signature check
- **THEN** Astrail marks it unusable
- **AND** emits a diagnostic that identifies the failed verification step without exposing credentials
