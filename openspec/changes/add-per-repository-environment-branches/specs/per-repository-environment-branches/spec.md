## Purpose

Allow one environment to represent a working set of repositories whose target branches differ, while preserving safe and reviewable checkout behavior.

## ADDED Requirements

### Requirement: Resolve a target branch for every environment member
The system SHALL support `checkout.branches` keyed by member repository ID, taking precedence over optional `checkout.branch`. It MUST reject overrides outside the membership, empty branch values, and members with no target.

#### Scenario: Fallback with overrides
- **WHEN** default declares workspace, appsvr, udr, and liteapp with fallback master and overrides workspace=main and appsvr=feature/app
- **THEN** each member resolves to its override or master, without requiring additional environments

#### Scenario: Complete mapping without fallback
- **WHEN** every member has an explicit override and checkout.branch is absent
- **THEN** the environment is valid and configured

#### Scenario: Invalid mappings
- **WHEN** an override names a non-member or a member has no target
- **THEN** validation reports the offending repository and checkout does not mutate repositories

#### Scenario: Legacy and resource-only environments
- **WHEN** an environment has only checkout.branch or has neither checkout nor repositories
- **THEN** existing shared-branch or resource-only behavior is preserved

### Requirement: Safely execute heterogeneous checkout plans
The system SHALL inspect and plan each physical checkout against its resolved branch, deduplicate members sharing a physical checkout, and reject conflicting targets. Existing authorization, local-branch existence, dirty-worktree, stale-plan, and partial-failure protections MUST remain in effect.

#### Scenario: Multiple physical repositories
- **WHEN** the reviewed plan targets different existing branches on clean repositories
- **THEN** authorized apply switches each to its specified branch and verifies each result

#### Scenario: Shared physical checkout
- **WHEN** two members share a physical checkout and request different branches
- **THEN** status and preview report the conflicting members and targets and apply makes no changes

#### Scenario: Changed target after review
- **WHEN** a member's effective target changes after preview
- **THEN** the reviewed plan is rejected as stale before switching

### Requirement: Author and inspect per-repository targets
Machine and interactive authoring SHALL accept an optional default branch and repository branch mapping. Human and JSON output SHALL identify each member's desired branch and avoid presenting a fallback as the target of all members.

#### Scenario: Machine authoring
- **WHEN** env add receives repositories and branches without branch
- **THEN** dry-run previews checkout.branches and authorized apply writes the reviewed mapping without switching branches

#### Scenario: Interactive authoring and inspection
- **WHEN** a user selects distinct branches for environment members
- **THEN** the reviewed declaration and subsequent status expose those per-member targets
