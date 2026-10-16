## Purpose

Make repository addition complete after one reviewed authorization, while preserving existing files and making failed preparation recoverable through the same entry point.

## ADDED Requirements

### Requirement: Combined scoped addition
Repository addition SHALL default to registration and preparation in one plan. The preview and plan identity MUST include clone targets, source revisions, and required source ancestors. Explicit declaration-only requests SHALL skip preparation. No unrelated repository, Distribution, or projection SHALL be changed.

#### Scenario: Git addition
- **WHEN** a user approves a preview for a missing Git repository
- **THEN** Astrail registers and clones it before returning success and scans its Skills
- **AND** dry-run performs no writes or network operations

#### Scenario: Subpath source
- **WHEN** an added subpath depends on a missing managed Git parent
- **THEN** the preview includes that parent and preparation verifies the subpath after cloning the parent

#### Scenario: Declaration only
- **WHEN** preparation is explicitly disabled
- **THEN** Astrail only registers the declaration and reports preparation as skipped

### Requirement: Safe and recoverable preparation
Astrail SHALL reuse semantically identical declarations and valid existing checkouts without changing their contents. Conflicting declarations or occupied destinations MUST be reported without overwriting them. A failed preparation SHALL retain successful registration, report a failed stage, and support a newly reviewed retry of the same request. Changed configuration or destinations MUST invalidate the reviewed plan before mutation.

#### Scenario: Retry clone failure
- **WHEN** cloning fails after registration and the same request is previewed and approved again
- **THEN** Astrail prepares the already registered repository without adding a duplicate or rewriting its declaration

#### Scenario: Destination changed
- **WHEN** a destination becomes occupied after preview
- **THEN** apply rejects the stale plan without overwriting the destination

#### Scenario: Existing unrelated checkout
- **WHEN** the destination contains a checkout with a different origin
- **THEN** preparation reports a conflict and preserves that checkout

### Requirement: Optional Skill import after preparation
Human-terminal addition SHALL offer selective Skill import when importable candidates are found after preparation. Agent guidance SHALL instruct the Agent to offer that choice from returned candidates without waiting for a separate user request. Machine mode MUST remain non-interactive and SHALL return inventory and actionable next steps. Skill selection and trust MUST remain explicit; addition MUST NOT automatically import or project Skills.

#### Scenario: Terminal import declined
- **WHEN** repository preparation succeeds and the user declines Skill import
- **THEN** repository addition remains successful and no Skill declarations are written

#### Scenario: Machine workflow
- **WHEN** a machine request prepares a repository with Skills
- **THEN** the result contains the discovered candidates and import guidance without prompting

#### Scenario: No Skills
- **WHEN** the prepared repository has no discoverable Skills
- **THEN** addition completes without an import question
