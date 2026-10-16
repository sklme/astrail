## ADDED Requirements

### Requirement: Codex provides repository-first writing conventions
The managed Codex instructions SHALL distinguish maintained topic knowledge in `docs/` from task-specific records in `records/`. The guidance SHALL prefer the responsible repository, honor explicit user destinations and established project conventions, and reserve Workspace records for Workspace work or cross-repository work without a clear owner.

#### Scenario: A project has no records directory
- **WHEN** an Agent needs to preserve a project task and the owning repository has no records directory
- **THEN** the convention directs it to establish the record in that repository rather than move the material to the Workspace merely because the directory is absent

### Requirement: A bundled Skill supports persistent task material
The Codex target SHALL project the `astrail-records` Skill using the selected link, copy, or manifest strategy. The Skill SHALL cover task continuation, handoff, organization, and reusable knowledge extraction without requiring a record for routine answers or small edits.

#### Scenario: A task continues on a later date
- **WHEN** the same task resumes with an existing record
- **THEN** the convention directs the Agent to update that record and its current conclusions rather than create a dated duplicate

#### Scenario: Knowledge is extracted
- **WHEN** task findings support reusable guidance
- **THEN** the convention directs the Agent to update an existing topic document where available and link supporting records rather than copy the entire task timeline

### Requirement: Synchronization preserves business material
The convention SHALL remain advisory. Synchronization MUST NOT create record directories, migrate business documents, or modify existing record contents, and SHALL preserve custom guidance outside the managed region. Historical records SHALL be treated as evidence rather than current facts or execution authority.

#### Scenario: A Workspace already contains records and docs
- **WHEN** the user synchronizes the new guidance and Skill
- **THEN** existing business files and custom guidance remain unchanged and a second projection plan reports no remaining changes

#### Scenario: A Workspace has no records or docs
- **WHEN** the user synchronizes the new guidance and Skill
- **THEN** neither records nor docs directories are created by synchronization
