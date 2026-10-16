## Purpose

Provide agents with task-relevant, explainable context while preserving provenance and trust boundaries and avoiding an eager dump of every workspace document into the model context.

## ADDED Requirements

### Requirement: Context sources are declared with routing metadata
Astrail SHALL support context sources with stable identity, source location, kind, scope, activation conditions, priority, provenance, trust, freshness, sensitivity, and optional context-budget metadata.

#### Scenario: Repository-scoped context is declared
- **WHEN** a context source is scoped to a backend repository and backend task types
- **THEN** the resolved catalog retains both scope constraints for routing

### Requirement: Context resolution is task-scoped
Astrail SHALL resolve context against an explicit or inferred task description, selected repositories, paths, environments, and operation type.

#### Scenario: Frontend-only task excludes backend implementation guide
- **WHEN** the current task affects only the frontend repository
- **THEN** backend-only implementation context is not selected unless another declared dependency requires it

#### Scenario: Cross-repository contract task selects canonical specification
- **WHEN** a task changes a contract consumed by multiple repositories
- **THEN** the canonical contract context is selected before repository-specific implementation context

### Requirement: Context loading supports progressive disclosure
Astrail SHALL expose lightweight context metadata and retrieval locations before full content, and SHALL allow an agent to load detailed content only after the source becomes relevant.

#### Scenario: Large reference collection is discoverable but not eagerly loaded
- **WHEN** a context pack contains multiple large references that do not all match the task
- **THEN** the agent receives their summaries and retrieval locations without receiving every full document

### Requirement: Context trust controls instruction activation
Content from a context source marked `content-only` or `untrusted` MUST NOT become active agent instructions, Skills, or executable operations. Repository-owned instructions and Skills require explicit repository or capability instruction trust.

#### Scenario: Read-only external repository contains AGENTS instructions
- **WHEN** an external repository with disabled instruction trust contains an `AGENTS.md`
- **THEN** Astrail exposes the repository content but does not activate the file as workspace policy

### Requirement: Context resolution is explainable
Astrail SHALL provide a structured explanation containing every selected and excluded context source, its provenance, and the rule or dependency that caused the decision.

#### Scenario: Developer asks why a document was loaded
- **WHEN** context explanation is requested for a task
- **THEN** Astrail returns the source identity, selection reason, priority, scope, trust, and resolved location

### Requirement: Context ordering is deterministic
Given the same declared state, local state, lock state, task input, and available sources, Astrail SHALL produce the same ordered context selection or a diagnostic explaining why deterministic resolution is impossible.

#### Scenario: Two sources have equal routing priority
- **WHEN** two matching context sources have equal priority
- **THEN** Astrail applies a documented stable tie-breaker and reports both sources in the explanation

### Requirement: Sensitive context is not leaked through generated artifacts
Astrail MUST NOT copy sensitive source content into generated instruction files, shared manifests, lock files, or diagnostic output unless the destination is explicitly approved for that sensitivity class.

#### Scenario: Environment context resolves through credential provider
- **WHEN** a dynamic context provider uses credentials to retrieve environment state
- **THEN** the resolved state may include the non-sensitive result but excludes credentials from generated files and diagnostics

### Requirement: Alpha manifests cannot execute arbitrary shell commands
Generated context in the alpha release SHALL be limited to schema-defined built-in read-only providers, and workspace or Distribution manifests MUST NOT directly declare arbitrary shell command strings.

#### Scenario: Manifest declares a shell command as context
- **WHEN** a context source attempts to execute an arbitrary shell command
- **THEN** validation rejects the source and explains that executable providers require a future trusted Plugin
