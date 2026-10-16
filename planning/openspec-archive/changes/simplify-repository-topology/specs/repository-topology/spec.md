## Purpose

Define deterministic physical and logical repository roots for an Astrail workspace across managed Git checkouts, linked local directories, and derived monorepo subpaths.

## ADDED Requirements

### Requirement: Repository sources are explicit and exclusive
Astrail SHALL require each repository to declare exactly one source of type `git`, `local`, or `subpath`, and SHALL reject legacy or mixed source fields rather than inferring a source silently.

#### Scenario: Git source validates
- **WHEN** a repository declares a Git URL, advisory access, and no local or subpath source fields
- **THEN** validation succeeds and structured output identifies the source as `git`

#### Scenario: Legacy source fields are rejected
- **WHEN** a repository declares a top-level `remote`, `path`, `checkout`, `revision`, or `presence` field
- **THEN** validation fails and identifies the unsupported field

### Requirement: Git sources have deterministic managed placement
Astrail SHALL resolve a Git repository to `<workspace>/repos/<repository-id>`, SHALL use its optional branch, tag, or commit revision during initial clone, and SHALL never clone over an existing filesystem entry.

#### Scenario: Required Git repository is absent
- **WHEN** a required Git source is absent during bootstrap
- **THEN** the preview contains one authorized clone action targeting `<workspace>/repos/<repository-id>`

#### Scenario: Git destination already exists
- **WHEN** the managed destination already exists
- **THEN** bootstrap preserves it and observes its Git identity instead of replacing it

### Requirement: Local sources are linked without ownership transfer
Astrail SHALL resolve a local source path relative to the workspace root unless it is absolute, and SHALL never clone, copy, move, update, or delete the referenced directory as part of repository lifecycle operations.

#### Scenario: Optional local source is absent
- **WHEN** an optional local source path is unavailable
- **THEN** status reports the repository as unavailable without planning a materialization action

#### Scenario: Required local source is absent
- **WHEN** a required local source path is unavailable
- **THEN** resolution reports an error that identifies the missing repository and path

### Requirement: Subpath sources derive from a parent repository
Astrail SHALL resolve a subpath source beneath the resolved path of a declared parent repository, SHALL forbid absolute or escaping paths, and SHALL reject unknown parents and dependency cycles.

#### Scenario: Monorepo package resolves
- **WHEN** repository `api` declares parent `platform` and path `packages/api`
- **THEN** `api` resolves to `<platform-path>/packages/api` without planning a second clone

#### Scenario: Subpath escapes its parent
- **WHEN** a subpath is absolute or contains a traversal that escapes its parent
- **THEN** validation fails without reading or mutating the escaped location

#### Scenario: Subpath dependency cycle exists
- **WHEN** repository source references form a cycle
- **THEN** resolution fails with a deterministic diagnostic identifying the cycle

### Requirement: Repository availability is explicit
Each repository SHALL expose a `required` boolean that defaults to `true`; missing required repositories SHALL produce errors while missing optional repositories SHALL remain inspectable without making the workspace invalid.

#### Scenario: Optional subpath is missing
- **WHEN** a parent repository exists but an optional child subpath does not
- **THEN** status reports the child as unavailable without reporting a required-repository error

### Requirement: Repository access is advisory and compositional
Each repository SHALL declare `read-only` or `read-write` access. Astrail SHALL warn about observed changes under read-only roots, SHALL NOT claim filesystem enforcement, and SHALL reject a subpath that widens a read-only parent's access.

#### Scenario: Child narrows parent access
- **WHEN** a read-write parent contains a child declared read-only
- **THEN** both repositories resolve with their declared access values

#### Scenario: Child widens parent access
- **WHEN** a read-only parent contains a child declared read-write
- **THEN** resolution reports an invalid access-widening error

### Requirement: Repository observations respect physical ownership
Astrail SHALL observe Git branch, HEAD revision, origin, and Git identity from the physical checkout, and SHALL scope dirty-state observation for a subpath repository to that subpath.

#### Scenario: Sibling package is modified
- **WHEN** a file outside a read-only subpath is modified in the same parent Git checkout
- **THEN** the subpath observation remains clean

#### Scenario: Child package is modified
- **WHEN** a file inside a read-only subpath is modified
- **THEN** the child observation is dirty and Astrail emits the read-only advisory warning

### Requirement: Repository instruction trust remains independent
Repository configuration SHALL retain only instruction trust in addition to source, availability, access, and descriptive metadata; content trust and executable trust SHALL NOT be repository properties.

#### Scenario: Repository instructions use the safe default
- **WHEN** a repository omits instruction trust
- **THEN** its content remains available while its repository-owned instructions and Skills remain disabled
