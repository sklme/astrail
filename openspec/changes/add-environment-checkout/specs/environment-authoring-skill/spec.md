## Purpose

Let an agent collect environment intent conversationally while delegating validation, previews, manifest writes, status, and Git checkout to Astrail's portable machine contracts.

## ADDED Requirements

### Requirement: The environment Skill translates conversational intent
The Codex environment-management Skill SHALL recognize requests to add, inspect, or use a shared-branch environment, infer only low-risk presentation defaults, and ask for repository membership or branch when it cannot determine them safely.

#### Scenario: User describes a Feature environment
- **WHEN** a user asks for a Feature A environment across known frontend and backend repositories
- **THEN** the Skill prepares an environment request using those repository identifiers and makes the proposed `feature/a` branch visible in preview

### Requirement: The environment Skill delegates all mutations
The Skill SHALL use non-interactive JSON commands for planning and applying environment authoring or checkout and MUST NOT directly patch manifests, run Git switch commands, or reproduce core validation rules.

#### Scenario: Core rejects environment membership
- **WHEN** the machine contract reports an unknown repository
- **THEN** the Skill explains the diagnostic and does not edit YAML manually

### Requirement: The environment Skill requires explicit authorization
The Skill SHALL present the current manifest or checkout plan and obtain explicit authorization before invoking apply. Manifest authoring and Git checkout SHALL be presented as separate mutations requiring separate authorization.

#### Scenario: Environment declaration is confirmed but checkout is not
- **WHEN** the user authorizes environment creation but has not authorized branch switching
- **THEN** the Skill applies only the environment declaration and leaves repository checkouts unchanged
