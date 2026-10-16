## Purpose

Provide one portable, previewable Skill-authoring contract that interactive clients, agents, scripts, and future adapters can share without duplicating Capability policy or editing manifests directly.

## ADDED Requirements

### Requirement: Skill additions are planned before mutation
Astrail SHALL normalize and validate a Skill addition as a deterministic change plan before writing Workspace files. The plan SHALL identify the resulting `kind: skill` Capability declaration, target manifest, diagnostics, and attributable file change in machine-readable form.

#### Scenario: Valid Git Skill is previewed
- **WHEN** a caller plans a Git Skill with canonical identity, URL, requested revision, and Skill subpath
- **THEN** Astrail returns a successful plan and performs no manifest write, network access, acquisition, or projection

#### Scenario: Existing Capability identifier is reused
- **WHEN** a caller plans a Skill whose Capability identifier already exists
- **THEN** Astrail reports a conflict and returns no applicable file change

### Requirement: Skill authoring uses Capability semantics
The authoring contract SHALL persist a Skill only as a Capability with `kind: skill` and SHALL accept direct Git, Workspace-relative, and declared-repository sources using the same identity, alias, version, trust, source-path, and repository-reference semantics used by Workspace resolution.

#### Scenario: Repository-owned Skill is added
- **WHEN** a caller adds a Skill from path `skills/api` in declared repository `platform`
- **THEN** the plan contains a repository-backed Skill Capability and does not add another repository declaration or acquisition action

#### Scenario: Standalone remote Skill is added
- **WHEN** a caller adds a direct Git Skill
- **THEN** the plan contains the Git source directly on the Capability and does not create a package, cache, or Workspace repository entry

#### Scenario: Skill source is invalid
- **WHEN** a caller provides an unknown repository, an unsafe source path, an incomplete Git revision, or unsupported source fields
- **THEN** planning fails with structured diagnostics and no file change

### Requirement: Skill authoring provides deterministic defaults
The authoring contract SHALL require canonical Skill identity and SHALL derive an omitted exposed alias and Capability identifier from the final identity segment. Explicit identifiers and aliases SHALL be validated using Workspace identifier rules and SHALL remain visible in the plan.

#### Scenario: Alias and identifier are omitted
- **WHEN** identity `example/loghelper` is planned without an identifier or alias
- **THEN** both default to `loghelper` and the normalized values are included in the preview

#### Scenario: Derived alias conflicts
- **WHEN** a derived or explicit alias conflicts with another active Capability
- **THEN** planning reports the Capability alias ambiguity before mutation

### Requirement: Applying a Skill plan is safe and verifiable
Astrail SHALL apply only a valid, current Skill plan after explicit caller authorization, SHALL preserve unrelated manifest content, and SHALL reload and verify the composed Capability before reporting success. It SHALL refuse an unexpected plan identifier or a plan whose target file changed after preview.

#### Scenario: Current Skill plan is applied
- **WHEN** an authorized caller applies a valid plan and the shared manifest is unchanged
- **THEN** Astrail writes only `capabilities.<id>`, verifies the resolved Skill, and returns that Capability

#### Scenario: Manifest changes after preview
- **WHEN** the shared manifest changes after planning and before apply
- **THEN** Astrail refuses the stale plan without overwriting the newer content

#### Scenario: Post-write verification fails
- **WHEN** the composed Workspace does not resolve the planned Skill after writing
- **THEN** Astrail restores the original manifest and reports the verification failure

### Requirement: Skill declaration does not imply acquisition
Adding a Skill SHALL update configuration only. Git acquisition and target projection SHALL require a separate explicit synchronization request with its own preview and authorization.

#### Scenario: Git Skill is added without synchronization
- **WHEN** an authorized caller applies a direct Git Skill addition
- **THEN** the manifest contains the Capability while `.agents/skills/<alias>` remains absent until synchronization is authorized

### Requirement: Human and machine adapters share one behavior contract
Interactive and non-interactive adapters SHALL submit the same request to the portable Skill-authoring contract and SHALL produce equivalent plans for equivalent input. Non-interactive and JSON operation SHALL never prompt and SHALL expose structured success and failure output.

#### Scenario: Equivalent CLI inputs produce the same plan
- **WHEN** interactive answers and machine-readable JSON describe the same Skill
- **THEN** both adapters produce equivalent normalized declarations, diagnostics, plan identifiers, and file changes

#### Scenario: Non-interactive input is incomplete
- **WHEN** machine-readable input omits canonical identity or required source information
- **THEN** the command fails with structured diagnostics instead of prompting
