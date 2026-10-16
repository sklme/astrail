## Purpose

Let an agent guide users through Skill Capability configuration in natural language while delegating preview, validation, and mutation to Astrail's portable Skill-authoring contract.

## ADDED Requirements

### Requirement: The Skill authoring Skill translates conversational intent
The Codex Skill-management Skill SHALL recognize requests to add direct Git, Workspace-relative, and repository-owned Skills, infer low-risk identifiers and aliases, and ask only for information required to produce a valid authoring request.

#### Scenario: User provides a remote Skills repository
- **WHEN** a user identifies a Git remote and a Skill subpath but omits an exposed alias
- **THEN** the Agent Skill prepares a Git Skill request and makes the inferred alias visible in the dry-run plan

#### Scenario: User refers to an existing business repository
- **WHEN** a user says a Skill belongs to an already declared repository
- **THEN** the Agent Skill inspects repository identifiers when needed and prepares a repository-backed source rather than a direct Git source

### Requirement: The Skill authoring Skill delegates mutations
The Agent Skill SHALL use the non-interactive machine contract to plan and apply additions and SHALL NOT directly patch Astrail manifests, independently reproduce Capability validation, add a transport repository, or acquire remote content during declaration.

#### Scenario: Agent previews a Skill addition
- **WHEN** the Agent Skill has enough information to add a Skill
- **THEN** it invokes dry-run planning and presents the normalized Capability, target file, diagnostics, and plan identifier

#### Scenario: Core rejects a Skill request
- **WHEN** the machine contract returns an error diagnostic
- **THEN** the Agent Skill explains the diagnostic and does not attempt a manual manifest edit

### Requirement: The Skill authoring Skill requires authorization to apply
The Agent Skill SHALL obtain explicit authorization after presenting the current plan before invoking apply, and SHALL treat subsequent Git acquisition and projection as a separate action with a separate preview and authorization.

#### Scenario: User has not confirmed the plan
- **WHEN** a valid Skill plan has been presented but the user has not authorized it
- **THEN** the Agent Skill leaves Workspace files unchanged

#### Scenario: User requests adding and installing
- **WHEN** a user explicitly requests both declaration and installation
- **THEN** the Agent Skill applies the Skill plan first, previews synchronization separately, and asks for authorization before remote acquisition
