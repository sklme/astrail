## Purpose

Allow Astrail workspaces to acquire remote Git-hosted capabilities directly and reproducibly without treating their transport repositories as business topology or retaining a persistent capability cache.

## ADDED Requirements

### Requirement: Git is a direct capability source
Astrail SHALL allow a capability to declare a Git URL, exactly one requested branch, tag, or commit revision, and a safe repository-relative content path without declaring the remote source under Workspace repositories.

#### Scenario: Remote Skill is declared directly
- **WHEN** a Skill capability declares a Git URL, tag, and `skills/loghelper` content path
- **THEN** validation succeeds and the resolved capability identifies Git as its source while Workspace repository topology remains unchanged

#### Scenario: Git content path escapes the checkout
- **WHEN** a Git capability declares an absolute path or a path that escapes its acquired checkout
- **THEN** validation or acquisition fails before any content is projected

### Requirement: Git acquisition is temporary and cache-free
Astrail SHALL acquire a Git capability through operation-scoped staging, SHALL remove the staging checkout after success or failure, and MUST NOT require or retain a persistent capability package or capability content cache.

#### Scenario: Successful acquisition leaves no checkout
- **WHEN** an authorized Git Skill acquisition completes
- **THEN** only declared configuration, lock state, and target-owned projection state remain durable and no acquired Git checkout remains in Workspace repository topology or Astrail cache state

#### Scenario: Acquisition fails during validation
- **WHEN** staged content is missing the required Skill entry document or does not match the declared content path
- **THEN** Astrail removes staging state, preserves the previous projection, and reports an actionable error

### Requirement: Network acquisition is previewable and authorized
Astrail SHALL expose every required Git capability acquisition in a dry-run change plan and SHALL require explicit authorization before accessing the network or replacing an installed projection.

#### Scenario: Bootstrap previews a missing Git Skill
- **WHEN** bootstrap or synchronization plans a Git Skill whose projection is absent
- **THEN** the plan reports its remote identity, requested revision, selected path, destination, and authorization requirement without cloning it

#### Scenario: Authorization is absent
- **WHEN** a plan containing a Git acquisition is applied without explicit authorization
- **THEN** Astrail performs no network operation and preserves existing projection content

### Requirement: Remote Skills are managed copies
Astrail SHALL project an acquired Git Skill as a target-owned copy and SHALL perform replacement atomically so a target never observes a partial installation.

#### Scenario: Codex installs an acquired Skill
- **WHEN** an authorized acquisition validates a Skill exposed as `loghelper`
- **THEN** Codex receives a managed copy at `.agents/skills/loghelper` and the projection manifest records its source and integrity

#### Scenario: An unowned destination exists
- **WHEN** `.agents/skills/loghelper` exists but is not recorded as Astrail-owned
- **THEN** synchronization refuses to replace it and reports an ownership conflict

### Requirement: Lock state preserves Git provenance
Astrail SHALL record the declared source URL, requested revision, resolved commit, selected content path, and deterministic content integrity for each acquired Git capability without storing acquired content in the lock.

#### Scenario: Tag resolves to a commit
- **WHEN** a Git capability requested as tag `v1.2.0` is acquired at commit `abc123`
- **THEN** lock and projection metadata preserve both the requested tag and resolved commit together with the selected path and integrity

#### Scenario: Locked projection content drifts
- **WHEN** a managed Skill copy no longer matches locked or projected integrity
- **THEN** doctor or synchronization reports drift and requires authorized reacquisition before replacement

### Requirement: Acquisition is deterministic and idempotent
Astrail SHALL skip network acquisition when an existing owned projection matches the declared Git source, requested revision, selected path, and recorded integrity, and SHALL reacquire when any of those inputs changes or the projection is missing.

#### Scenario: Repeated synchronization is satisfied
- **WHEN** synchronization runs twice without source, lock, or projection changes
- **THEN** the second plan contains no acquisition or projection action

#### Scenario: Requested tag changes
- **WHEN** the declared requested tag changes from `v1.2.0` to `v1.3.0`
- **THEN** synchronization plans an authorized reacquisition and preserves the old managed copy until the new content is validated

### Requirement: Repository-backed capabilities remain topology-owned
Astrail SHALL continue to support repository-backed capabilities only by referencing a repository already declared in Workspace topology and SHALL NOT acquire a standalone remote capability through repository lifecycle operations.

#### Scenario: Business repository exports its own Skill
- **WHEN** a declared application repository exposes a trusted repository-owned Skill
- **THEN** Astrail resolves that Skill from the existing repository root without a separate Git capability acquisition
