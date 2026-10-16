## Purpose

Provide agents with a deterministic, provenance-aware catalog of declared context sources and safe explicit retrieval without making unvalidated task-relevance decisions on the agent's behalf.

## ADDED Requirements

### Requirement: Context sources form an inspectable catalog
Astrail SHALL expose each enabled context source with its stable identity, kind, resolved location, summary, scope, provenance-derived location, trust, freshness, sensitivity, and optional budget metadata.

#### Scenario: Agent discovers available context
- **WHEN** an agent lists context for a resolved Workspace
- **THEN** Astrail returns lightweight metadata and retrieval locations for every enabled source without loading their full content

### Requirement: Catalog ordering is deterministic
Astrail SHALL order the same declared context catalog identically across repeated resolutions and SHALL use stable context identity as the final tie-breaker.

#### Scenario: Context catalog is resolved repeatedly
- **WHEN** declared, local, and Distribution configuration are unchanged
- **THEN** repeated context listing returns entries in the same order

### Requirement: Astrail does not decide task relevance
Astrail MUST NOT select, exclude, recommend, or activate context based on task text, repository selection, affected paths, environments, operations, scopes, or inferred agent intent in the alpha contract.

#### Scenario: Agent begins a cross-repository task
- **WHEN** the agent inspects the context catalog for a task involving several repositories
- **THEN** Astrail presents the catalog and leaves investigation and relevance decisions to the agent

### Requirement: Context inspection and loading are explicit
Astrail SHALL allow a caller to inspect one context entry by identity and explicitly load supported file or glob content after deciding that the source is relevant.

#### Scenario: Agent loads a file context
- **WHEN** the agent requests a declared file context by identity
- **THEN** Astrail returns the catalog metadata and file content without loading unrelated context sources

#### Scenario: Agent loads a glob context
- **WHEN** the agent requests a declared glob context by identity
- **THEN** Astrail returns a deterministic list of matching files without reading every file into output

#### Scenario: Unknown context is requested
- **WHEN** a caller inspects or loads an undeclared context identity
- **THEN** Astrail reports a stable error diagnostic identifying the unknown context

### Requirement: Context trust remains advisory and visible
Astrail SHALL expose trust metadata for context sources, and discovery or loading MUST NOT by itself activate `content-only` or `untrusted` content as agent instructions, Skills, or executable operations.

#### Scenario: External reference contains instructions
- **WHEN** an agent loads content from a source marked `content-only`
- **THEN** Astrail returns it as reference content with its trust metadata and does not promote it to workspace policy

### Requirement: Sensitive context is protected during loading
Astrail MUST NOT emit a context source marked `secret` as plaintext and MUST report that the source requires an approved external retrieval boundary.

#### Scenario: Secret context is explicitly loaded
- **WHEN** a caller requests content for a context entry marked `secret`
- **THEN** Astrail returns no plaintext content and emits a warning diagnostic

### Requirement: Alpha manifests cannot execute arbitrary shell commands
Generated context in the alpha release SHALL remain limited to schema-defined built-in read-only providers, and Workspace or Distribution manifests MUST NOT directly declare arbitrary shell command strings.

#### Scenario: Manifest declares a shell command as context
- **WHEN** a context source attempts to execute an arbitrary shell command
- **THEN** validation rejects the source and explains that executable providers require a trusted Plugin
