## Purpose

Let an agent guide users through repository configuration in natural language while delegating all decisions, previews, and mutations to Astrail's portable repository-authoring contract.

## ADDED Requirements

### Requirement: The repository Skill translates conversational intent
The Codex repository-management Skill SHALL recognize requests to add Git repositories, linked local directories, and monorepo subpaths; infer low-risk defaults; and ask only for information required to produce a valid authoring request.

#### Scenario: User describes a monorepo package
- **WHEN** a user says an API package lives at `packages/api` in an existing repository
- **THEN** the Skill prepares a subpath request and asks for a parent only when it cannot identify one safely

#### Scenario: User supplies a Git URL
- **WHEN** a user asks to add a Git URL without an identifier
- **THEN** the Skill proposes an identifier derived from the repository name and makes the proposed value visible before apply

### Requirement: The repository Skill delegates mutations
The Skill SHALL use the non-interactive machine contract to plan and apply changes and SHALL NOT directly patch Astrail manifests or independently reproduce topology validation rules.

#### Scenario: Skill previews a change
- **WHEN** the Skill has enough information to add a repository
- **THEN** it invokes dry-run planning and presents the returned target, declaration, diagnostics, and file changes to the user

#### Scenario: Core rejects a request
- **WHEN** the machine contract returns an error diagnostic
- **THEN** the Skill explains that diagnostic and does not attempt a manual manifest edit

### Requirement: The repository Skill requires authorization to apply
The Skill SHALL obtain explicit authorization after presenting the current plan before invoking apply, and SHALL treat repository materialization as a separate action requiring its own explicit intent.

#### Scenario: User has not confirmed the preview
- **WHEN** a valid plan has been presented but the user has not authorized it
- **THEN** the Skill leaves workspace files unchanged

#### Scenario: User requests adding and cloning
- **WHEN** a user explicitly requests both configuration and preparation
- **THEN** the Skill applies the repository plan first and invokes bootstrap as a separately described follow-up action
