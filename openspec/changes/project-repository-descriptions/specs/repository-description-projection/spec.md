## Purpose

Ensure every repository can expose a concise, reviewable statement of responsibility to humans,
automation, and projected coding agents without eagerly introducing a detailed Context model.

## ADDED Requirements

### Requirement: Repository authoring captures a reviewed description
Astrail SHALL support a concise repository description in the shared repository addition request,
plan, and apply result. The interactive terminal adapter SHALL ask for a non-empty description. A
machine or Agent request MAY omit the field for compatibility, but the resulting plan SHALL report
the missing project knowledge as informational guidance rather than silently inventing text.

#### Scenario: Human adds a described repository
- **WHEN** a user runs interactive `repo add` and supplies a repository responsibility description
- **THEN** the reviewed plan and applied manifest contain that exact normalized description

#### Scenario: Machine input omits a description
- **WHEN** a machine-readable repository addition request omits description
- **THEN** planning remains compatible, returns an informational diagnostic with remediation, and
  does not synthesize a description

### Requirement: Agent authoring makes description intent explicit
The projected repository-authoring Skill SHALL gather or propose a concise description, include it
in the same machine-readable dry-run used by other adapters, and present the planned value before
requesting apply authorization. Repository content MAY inform a proposal, but Astrail MUST NOT treat
an inferred description as user-authorized until it appears in the reviewed plan.

#### Scenario: Agent proposes a description from available evidence
- **WHEN** an Agent derives a responsibility summary from the user's request or repository documents
- **THEN** it labels the text as a proposal, includes it in the JSON dry-run, and waits for explicit
  authorization of the returned plan before apply

#### Scenario: Agent lacks enough evidence
- **WHEN** an Agent cannot determine what the repository owns
- **THEN** it asks the user for a concise description instead of fabricating one

### Requirement: Resolved topology exposes repository descriptions
The portable resolved workspace and structured repository inspection output SHALL preserve every
declared repository description together with its existing role, source, access, and requiredness.

#### Scenario: Described repository is resolved
- **WHEN** a workspace repository declares a description
- **THEN** status and repository inspection JSON expose the same description on the resolved
  repository

### Requirement: Codex projection identifies repository responsibilities
The Astrail-managed Codex instructions SHALL render each repository's role when available and its
description alongside the existing source, access, and requiredness facts. Missing descriptions
SHALL remain visible as an explicit knowledge gap, while detailed Context content SHALL NOT be
eagerly embedded by this capability.

#### Scenario: Managed instructions render a described repository
- **WHEN** Codex projection is rendered for a repository with role `backend` and a description
- **THEN** the repository catalog contains its identifier, role, description, source, access, and
  requiredness

#### Scenario: Managed instructions render a legacy repository
- **WHEN** a repository has no description
- **THEN** the repository catalog states that no description is declared without failing projection

### Requirement: Missing repository descriptions are advisory
Workspace doctor SHALL emit one informational diagnostic that identifies every enabled repository
without a description and provides authoring remediation. This diagnostic MUST NOT make doctor fail
or become a warning solely because strict mode is enabled.

#### Scenario: Doctor inspects legacy repository metadata
- **WHEN** one or more enabled repositories omit description
- **THEN** doctor succeeds and returns one informational diagnostic with the sorted repository IDs

#### Scenario: Every repository is described
- **WHEN** all enabled repositories declare non-empty descriptions
- **THEN** doctor does not emit the missing-description diagnostic
