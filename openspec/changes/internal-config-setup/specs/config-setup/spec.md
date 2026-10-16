## ADDED Requirements

### Requirement: Internal setup resources
Astrail SHALL prepare active Skills referenced by setup identities outside the daily Skill discovery directory, retaining their resources and existing trust and integrity constraints.

#### Scenario: Initialization resources
- **WHEN** bootstrap prepares a valid setup Skill
- **THEN** its complete resources are available under `.astrail/setups/<alias>/`
- **AND** it is absent from `.agents/skills/`
- **AND** daily Skills retain their configured projection behavior

#### Scenario: Manifest-only daily projection
- **WHEN** the daily projection strategy is manifest-only
- **THEN** setup still has a readable internal SKILL.md and supporting resources

#### Scenario: Unavailable setup
- **WHEN** a setup identity is missing, disabled, not a Skill, untrusted, or has no readable entry
- **THEN** bootstrap reports it as blocked and provides no instruction to execute it

### Requirement: Complete initialization handoff
Astrail SHALL instruct the Agent to continue available setup entries within the original initialization request. The CLI SHALL NOT execute setup or infer authentication or completed initialization from resource availability.

#### Scenario: Available setup
- **WHEN** bootstrap successfully prepares setup entries
- **THEN** JSON and human output give absolute entry paths and continuation instructions in dependency order
- **AND** generated Workspace guidance includes completing setup in initialization without requiring a separate request

#### Scenario: Preview and inspection
- **WHEN** the user previews bootstrap, inspects status or doctor, or performs ordinary sync
- **THEN** the CLI does not execute setup
- **AND** preview entries carry no execution instruction

#### Scenario: Repeated initialization or missing prerequisites
- **WHEN** the Agent continues setup
- **THEN** guidance directs it to check existing configuration first and report unresolved login or credentials as unfinished initialization

#### Scenario: No setup in the parent
- **WHEN** a parent omits setup or declares `mode: none`
- **THEN** it adds no handoff entry and dependency setups remain available
- **AND** unrelated enabled capabilities remain normal daily Skills

### Requirement: Owned legacy setup migration
Astrail SHALL migrate owned daily setup projections to internal resources through the normal preview and sync process, preserving user changes and source files.

#### Scenario: Verified Git copy
- **WHEN** an existing owned Git setup copy matches its recorded source and integrity constraints
- **THEN** it is reused locally without fetching and retains its resolved commit and digest
- **AND** its daily entry is removed after replacement resources are ready

#### Scenario: Changed or unowned paths
- **WHEN** a legacy setup copy or link was modified, or a destination is user-owned
- **THEN** migration reports a diagnostic and preserves the affected paths
