## Purpose

Define the portable, versioned Astrail workspace contract that describes repositories, environments, context, capabilities, operations, and advisory policy without absorbing the underlying projects.

## ADDED Requirements

### Requirement: Workspace manifests are versioned and schema-validatable
Astrail SHALL recognize a shared `astrail.yaml` document with explicit `apiVersion`, `kind`, and workspace metadata, and SHALL publish a machine-readable schema for every supported API version.

#### Scenario: Supported manifest validates
- **WHEN** a workspace manifest conforms to a supported Astrail schema version
- **THEN** validation succeeds and reports the resolved API version

#### Scenario: Unsupported manifest version is rejected
- **WHEN** a workspace declares an unsupported `apiVersion`
- **THEN** validation fails with an error that identifies the unsupported version and available migration guidance

### Requirement: Shared, local, resolved, and locked state remain distinct
Astrail SHALL distinguish team-owned declarations in `astrail.yaml`, machine-local overrides in `astrail.local.yaml`, the in-memory resolved workspace, and reproducibility data in `astrail.lock.yaml`.

#### Scenario: Local repository source path overrides shared defaults
- **WHEN** a developer configures a local repository source path in `astrail.local.yaml`
- **THEN** resolution uses that local-source path without modifying the shared manifest

#### Scenario: Lock data does not become declared configuration
- **WHEN** Astrail records resolved revisions and dependency versions
- **THEN** it writes them to the lock state without copying them into the shared declarations

### Requirement: Repository sources and policies are explicit
Astrail SHALL require every repository to declare one managed Git, linked local, or derived subpath source. Requiredness, advisory access, role, Git revision selection, and instruction trust SHALL remain inspectable policies. Declaring a repository SHALL make its content available without requiring repository-content trust, and executable trust SHALL remain in the separate Plugin lifecycle.

#### Scenario: Required read-only repository is valid
- **WHEN** a repository is both required for the workspace and declared read-only
- **THEN** the manifest validates and both properties remain visible in resolved state

#### Scenario: Optional read-write repository is valid
- **WHEN** an optional local repository is available and declared read-write
- **THEN** Astrail resolves it without treating optional requiredness as read-only access

#### Scenario: Monorepo subpath is a logical repository
- **WHEN** a repository declares another repository as its parent and a contained relative path
- **THEN** Astrail resolves the logical root without materializing a second checkout

#### Scenario: Repository instructions remain disabled by default
- **WHEN** a repository is declared without instruction trust
- **THEN** its content is available but its repository-owned instructions and Skills are not activated automatically

### Requirement: Environments are independent from Git branches
Astrail SHALL model environments as named workspace resources and MUST NOT infer an environment solely from a current or configured Git branch.

#### Scenario: Experience environment exists without experience branch
- **WHEN** an experience environment is declared but no repository experience branch is configured
- **THEN** environment resolution succeeds and reports the branch role as independently unavailable

### Requirement: Secrets are referenced rather than embedded
Shared manifests, local manifests intended for inspection, resolved output, and lock files MUST NOT contain resolved secret values; environment and plugin configuration SHALL use secret references or external credential providers.

#### Scenario: Manifest contains a literal secret in a protected field
- **WHEN** validation detects a literal credential where a secret reference is required
- **THEN** Astrail reports an error without printing the credential value

### Requirement: Advisory policy is represented explicitly
Astrail SHALL distinguish invalid configuration from advisory policy deviations and SHALL expose diagnostics with stable error, warning, and information severities.

#### Scenario: Read-only policy is violated outside Astrail
- **WHEN** Astrail observes local modifications in a repository declared read-only
- **THEN** it reports a warning and suggested remediation without claiming that the modification was prevented

### Requirement: Extensions are namespaced
Astrail SHALL allow implementation-specific configuration only under a namespaced extension location and SHALL preserve unknown extension data without treating it as core behavior.

#### Scenario: Codex-specific setting is declared
- **WHEN** a manifest contains configuration under `extensions.codex`
- **THEN** core validation preserves the value while Codex-specific validation is delegated to the Codex integration

### Requirement: Effective configuration is inspectable and explainable
Astrail SHALL expose the deterministic configuration produced by composing defaults, ordered Distributions, shared declarations, machine-local overrides, and lock constraints, and SHALL retain a provenance chain for every selected, overridden, disabled, or conflicting value.

#### Scenario: Developer inspects the effective configuration
- **WHEN** the developer requests the effective configuration as YAML or JSON
- **THEN** Astrail returns the merged declaration without runtime Git observations or resolved secret values

#### Scenario: Developer explains an overridden field
- **WHEN** the developer requests an explanation for a local-source path overridden locally
- **THEN** Astrail returns the winning value and the ordered source locations of every contributing and overridden layer

### Requirement: Composition semantics are deterministic
Astrail SHALL use schema-defined identity and replacement rules for composition, SHALL NOT merge ordered arrays by position, and SHALL NOT treat YAML merge keys as Astrail composition semantics.

#### Scenario: Local repository entry overrides a Distribution default
- **WHEN** both layers declare the same repository identity
- **THEN** fields merge by schema rules, the local value wins where specified, and the provenance index retains both declarations
