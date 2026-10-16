## Purpose

Provide read-only consistency status and an explicitly authorized, non-networked local checkout workflow for applying one environment branch safely across its repositories.

## ADDED Requirements

### Requirement: Environment status compares desired and observed branches
Astrail SHALL report each checkout-enabled environment's desired branch and the presence, Git identity, current branch, dirty state, and consistency status of every referenced repository without mutating files, branches, or remotes.

#### Scenario: All repositories match
- **WHEN** every repository referenced by `feature-a` is currently on `feature/a`
- **THEN** environment status reports the environment as consistent

#### Scenario: One repository differs
- **WHEN** one referenced repository is currently on another branch
- **THEN** status identifies that repository as mismatched without switching it

#### Scenario: Environment has no checkout
- **WHEN** status is requested for a resource-only environment
- **THEN** Astrail reports that the environment has no checkout configuration

### Requirement: Environment checkout is planned before Git mutation
Astrail SHALL produce a checkout plan from the current composed declaration and local Git observations before switching branches. The plan SHALL deduplicate logical repositories backed by the same physical Git checkout and SHALL identify no-op and branch-switch actions.

#### Scenario: Repository already uses the environment branch
- **WHEN** a referenced checkout is already on the desired branch
- **THEN** its plan action is a no-op

#### Scenario: Logical subpaths share one checkout
- **WHEN** multiple referenced repository identities resolve inside one physical Git checkout
- **THEN** the plan contains one physical branch-switch action and retains the affected repository identities for explanation

### Requirement: Unsafe local checkout is refused
Checkout planning MUST fail before mutation when a required path is missing, a physical root is not a Git checkout, a branch switch would affect a dirty checkout, or the target local branch does not exist. The initial workflow MUST NOT create branches or perform fetch, pull, push, deletion, or deployment.

#### Scenario: Repository has uncommitted changes
- **WHEN** a referenced repository needs a branch switch and its physical checkout is dirty
- **THEN** planning reports an error and no repository is switched

#### Scenario: Target branch is absent locally
- **WHEN** the environment branch does not exist as a local branch in one referenced checkout
- **THEN** planning reports an error with remediation and performs no network or Git mutation

### Requirement: Applying checkout requires a current authorized plan
Astrail SHALL switch branches only after explicit authorization of the current successful plan. Apply MUST reject stale declarations or observations, report every completed and remaining action if execution fails, and MUST NOT claim cross-repository atomicity.

#### Scenario: Current checkout plan is authorized
- **WHEN** the caller authorizes a successful plan and repository observations remain unchanged
- **THEN** Astrail switches every planned physical checkout and verifies the resulting branches

#### Scenario: Checkout changes after preview
- **WHEN** a repository branch or dirty state changes after preview
- **THEN** apply rejects the stale plan before executing the reviewed actions

### Requirement: Environment checkout supports human and machine callers
The CLI SHALL expose stable human and JSON status, dry-run, and authorized apply behavior. Agent guidance SHALL use those structured commands and obtain confirmation after presenting the current plan.

#### Scenario: Agent previews checkout
- **WHEN** an agent is asked to use an environment
- **THEN** it requests structured status and checkout preview before asking the user to authorize mutation
