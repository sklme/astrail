## Purpose

Provide one portable, previewable repository-authoring contract that interactive clients, agents, scripts, and future adapters can share without duplicating topology policy or editing manifests directly.

## ADDED Requirements

### Requirement: Repository additions are planned before mutation
Astrail SHALL normalize and validate a repository addition as a deterministic change plan before writing workspace files. The plan SHALL identify the normalized repository declaration, target manifest, diagnostics, and attributable file changes in machine-readable form.

#### Scenario: Valid Git repository is previewed
- **WHEN** a caller plans a Git repository addition with a URL and omits optional values
- **THEN** Astrail returns a successful plan with deterministic defaults and does not write or clone anything

#### Scenario: Invalid subpath is rejected consistently
- **WHEN** a caller plans a subpath whose parent is unknown or whose path escapes the parent
- **THEN** Astrail returns an error diagnostic and no applicable file change

### Requirement: Repository additions use existing topology semantics
The authoring contract SHALL accept Git, local, and subpath sources and SHALL validate required availability, advisory access, revision, parent access, and instruction trust using the same composed topology rules used by workspace resolution.

#### Scenario: Monorepo child is added
- **WHEN** a caller adds repository `api` with source repository `platform` and path `packages/api`
- **THEN** the planned composed workspace resolves `api` as a subpath of `platform` without planning another clone

#### Scenario: Child widens parent access
- **WHEN** a caller adds a read-write child beneath a read-only parent
- **THEN** planning fails with the same access-widening diagnostic produced by topology resolution

### Requirement: Manifest targeting is explicit and portable
The authoring contract SHALL support `shared`, `local`, and `auto` manifest targets. In `auto` mode it SHALL place portable declarations in the shared manifest and, for an absolute local source, SHALL split the portable repository declaration into the shared manifest and the machine-specific path into the local overlay. The plan SHALL report every selected target.

#### Scenario: Git source uses shared configuration
- **WHEN** a Git repository addition uses automatic targeting
- **THEN** Astrail plans the declaration in `astrail.yaml`

#### Scenario: Absolute local source uses machine-local configuration
- **WHEN** a local repository with an absolute path uses automatic targeting
- **THEN** Astrail plans its source type and policy in `astrail.yaml` and its path in `astrail.local.yaml`

### Requirement: Applying a repository plan is safe and verifiable
Astrail SHALL apply only a valid, current plan after explicit caller authorization, SHALL preserve unrelated manifest content, and SHALL reload and validate the composed workspace before reporting success. It SHALL refuse to apply a stale plan when a targeted file changed after planning.

#### Scenario: Current plan is applied
- **WHEN** an authorized caller applies a valid plan and targeted files are unchanged
- **THEN** Astrail updates only the planned manifest, verifies the composed topology, and returns the resulting repository

#### Scenario: Target changed after preview
- **WHEN** a targeted manifest changes after planning and before apply
- **THEN** Astrail refuses the stale plan without overwriting the newer content

#### Scenario: Existing repository identifier is reused
- **WHEN** a caller plans an addition whose identifier already exists
- **THEN** Astrail reports a conflict and preserves both manifests

### Requirement: Repository declaration does not imply materialization
Adding a repository SHALL update configuration only. Cloning or otherwise preparing a repository SHALL require a separate explicit bootstrap request.

#### Scenario: Git repository is added without bootstrap
- **WHEN** an authorized caller applies a Git repository addition
- **THEN** the manifest is updated and the managed checkout remains absent until bootstrap is invoked

### Requirement: Human and machine adapters share one behavior contract
Interactive and non-interactive adapters SHALL submit the same normalized request to the portable authoring contract and SHALL produce equivalent plans for equivalent input. Non-interactive operation SHALL never prompt and SHALL expose structured success and failure output.

#### Scenario: Equivalent CLI inputs produce the same plan
- **WHEN** the interactive CLI answers and non-interactive JSON describe the same repository
- **THEN** both adapters produce equivalent normalized declarations, target selection, diagnostics, and file changes

#### Scenario: Non-interactive input is incomplete
- **WHEN** machine-readable input omits required source information
- **THEN** the command fails with structured diagnostics instead of prompting
