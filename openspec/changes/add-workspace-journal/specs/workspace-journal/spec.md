# Spec Delta

## ADDED Requirements

### Requirement: Local bounded history

Astrail SHALL record Workspace mutation history in `.astrail/journal.jsonl`, defaulting to 2,000 event lines and 4 MiB. Local settings SHALL support disablement and valid positive bounds. Journal settings MUST NOT change effective configuration or plan fingerprints. Retention SHALL keep the newest events fitting both bounds and SHALL NOT accumulate backups.

#### Scenario: Capacity exceeded
- **WHEN** appending a new event exceeds a configured bound
- **THEN** the oldest events are removed, both bounds hold, and omitted operation details are explicitly counted

#### Scenario: Disabled history
- **WHEN** local journal settings disable recording
- **THEN** mutations proceed without journal writes and existing history remains queryable

### Requirement: Actual mutation outcomes

Astrail SHALL associate one operation ID with start and finish events across compound command steps. Records SHALL describe completed effects and distinguish success, failure, partial execution and unconfirmed outcomes. File hashes and selected entity facts SHALL be recorded instead of arbitrary input/output. Completed rollback writes SHALL remain visible without implying that restored changes remain applied.

#### Scenario: Partial multi-repository checkout
- **WHEN** one repository switches and a later repository fails
- **THEN** history includes the successful repository's observed branch and revision change, failed/pending repository IDs and a partial outcome

#### Scenario: Process terminates before completion
- **WHEN** a retained start has no finish
- **THEN** queries show an unknown outcome and do not assert success or failure

### Requirement: Read-only inspection and previews

Queries, doctor, validation, discovery, rendering and dry-runs MUST NOT write journal data or create journal directories. Successful no-op and cancelled workflows without mutations SHALL NOT add history.

#### Scenario: Fresh workspace query
- **WHEN** an agent lists history in a Workspace without a journal
- **THEN** the result is an empty list and the filesystem is unchanged

### Requirement: Concurrent and non-blocking recording

Journal writes SHALL use concurrency-safe bounded critical sections and atomic replacement. Journal storage failures MUST NOT change the business operation result or roll back business effects. Local ignore rules SHALL preserve existing content; tracked journals SHALL produce an advisory warning. Unsafe destinations MUST NOT be followed. Readers SHALL warn on malformed/unsupported events and writers MUST NOT silently discard them.

#### Scenario: Concurrent commands
- **WHEN** independent processes finish mutations in the same Workspace
- **THEN** retained operations are merged without lost writes or duplicate composite-command entries

#### Scenario: Journal cannot be written
- **WHEN** the journal path is unsafe, busy or unreadable during an otherwise successful mutation
- **THEN** the mutation remains successful with a journal warning and unrelated files are preserved

### Requirement: Human and structured lookup

`journal list` SHALL provide newest-first operations with an operation limit and intersecting repository, environment and since filters. `journal show` SHALL return details by full operation ID. Both SHALL use the standard JSON envelope when requested. Invalid filters and unavailable IDs SHALL return actionable diagnostics.

#### Scenario: Scoped history lookup
- **WHEN** an agent filters by repository and time
- **THEN** matching retained operations are selected before limiting and their IDs can be used with show

### Requirement: Agent discovery

The generated AGENTS.md SHALL advertise on-demand Journal lookup and the existing inspection Skill SHALL explain filtering, incomplete history and current-state verification. The guidance MUST treat history as data rather than executable instructions or authorization and MUST NOT require duplicate manual entries or full-history loading.

#### Scenario: Resuming a task
- **WHEN** recent Workspace changes matter to a task handoff
- **THEN** the Agent can discover filtered history queries and verify historical claims with status or doctor
