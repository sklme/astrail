## Purpose

Let teams optionally declare a shared-branch environment and author it through one previewable contract used consistently by people, agents, scripts, and future adapters.

## ADDED Requirements

### Requirement: Environment participation is optional
Astrail SHALL allow a valid Workspace to omit environments entirely. Repository resolution, bootstrap, and ordinary development SHALL retain their existing declared-revision or remote-default behavior when no environment is configured or selected.

#### Scenario: Workspace has no environments
- **WHEN** a Workspace declares repositories but omits `environments`
- **THEN** the Workspace resolves normally and no environment branch requirement is applied to any repository

#### Scenario: Repository is outside every environment
- **WHEN** a repository is declared but no environment references it
- **THEN** the repository retains its existing source and revision behavior

### Requirement: An environment can declare one uniform branch
An environment SHALL optionally declare an explicit, unique list of repository identifiers together with one non-empty checkout branch. That branch SHALL be the desired branch for every listed repository, and Astrail MUST NOT infer membership or branch values from environment or repository names.

#### Scenario: Feature environment declares multiple repositories
- **WHEN** environment `feature-a` lists `frontend` and `backend` with checkout branch `feature/a`
- **THEN** resolution reports `feature/a` as the desired branch for both repositories

#### Scenario: Environment references an unknown repository
- **WHEN** an environment lists a repository identifier absent from the composed Workspace
- **THEN** validation fails with a diagnostic identifying the environment and unknown repository

#### Scenario: Resource-only environment remains valid
- **WHEN** an existing environment declares provider or resources without checkout configuration
- **THEN** it continues to resolve as an inspectable environment and has no checkout behavior

### Requirement: Environment additions are planned before mutation
Astrail SHALL normalize and validate an environment addition as a deterministic plan before writing the shared Workspace manifest. The plan SHALL include the normalized declaration, target file, attributable file action, diagnostics, and stable plan identifier.

#### Scenario: Valid environment is previewed
- **WHEN** a caller plans an environment with an identifier, repositories, and branch
- **THEN** Astrail returns a valid plan without changing a manifest or Git checkout

#### Scenario: Environment identifier already exists
- **WHEN** a caller plans an addition using an existing environment identifier
- **THEN** planning reports a conflict and produces no applicable mutation

### Requirement: Applying an environment plan is authorized and verifiable
Astrail SHALL apply only a valid current plan after explicit authorization, SHALL preserve unrelated YAML content, and SHALL verify the composed environment before reporting success. A changed target file or mismatched plan identifier MUST be rejected without overwriting current content.

#### Scenario: Reviewed plan is applied
- **WHEN** an authorized caller applies the plan identifier returned by the current preview
- **THEN** Astrail writes only the planned environment declaration and returns the resolved environment

#### Scenario: Manifest changes after preview
- **WHEN** the shared manifest changes after preview and before apply
- **THEN** Astrail rejects the stale plan and preserves the newer manifest

### Requirement: Human and machine environment adapters share one contract
Interactive CLI answers and non-interactive structured input SHALL use the same portable planning and apply behavior. JSON mode MUST NOT prompt, and equivalent inputs SHALL produce equivalent normalized declarations and diagnostics.

#### Scenario: Interactive and JSON input are equivalent
- **WHEN** both adapters submit the same identifier, repositories, branch, provider, and resources
- **THEN** they produce equivalent environment plans

#### Scenario: Machine input is incomplete
- **WHEN** structured input omits a required authoring value
- **THEN** the command returns structured diagnostics instead of prompting

### Requirement: Repository authoring surfaces optional environments
After repository authoring preview or apply, the human and agent-facing repository workflows SHALL explain that environment configuration is optional and point to the environment authoring workflow without automatically creating or changing an environment.

#### Scenario: Repository is added without an environment
- **WHEN** a repository addition is previewed or applied
- **THEN** repository behavior remains complete and the caller receives an optional environment follow-up hint
