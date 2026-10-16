## ADDED Requirements

### Requirement: The UI is a client of public Astrail core contracts

Astrail SHALL render declared, resolved, observed, lock, diagnostic, provenance, and change-plan state through public core APIs and SHALL NOT implement an independent resolver or persistence model.

#### Scenario: A user inspects an overridden field

- **WHEN** the user selects a field in effective configuration
- **THEN** the UI displays its ordered composition layers and provenance
- **AND** the displayed value matches the CLI structured result for the same Workspace

#### Scenario: A user reviews a state-changing plan

- **WHEN** the UI requests a bootstrap, sync, update, or lock operation
- **THEN** it first displays the core-generated plan
- **AND** applies it only after the same authorization checks used by other clients

#### Scenario: A user inspects context sources

- **WHEN** the user opens the Workspace context catalog
- **THEN** the UI displays Core-provided identity, location, provenance, trust, sensitivity, and retrieval metadata
- **AND** the UI does not present task-based selected or excluded decisions
