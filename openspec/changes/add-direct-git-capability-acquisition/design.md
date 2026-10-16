## Context

See `proposal.md` for motivation. Today `resolveCapabilities` turns path-backed declarations into local paths, while the Codex target projects active Skills from those paths. A direct Git source has no durable local source path because this change deliberately excludes a persistent capability cache. Acquisition and projection must therefore occur in one operation while retaining the portable core/target boundary.

The current projection manifest already records ownership and integrity. It is the natural durable record of installed target content; the Workspace lock remains the portable record of resolution provenance.

## Goals / Non-Goals

**Goals:**

- Make the capability the only user-facing unit of declaration and resolution.
- Keep standalone Skill remotes out of Workspace repository topology.
- Stage remote content only for the duration of an authorized operation.
- Preserve non-destructive, idempotent, explainable projection semantics.
- Keep acquisition transport logic in core and Codex layout/ownership logic in the target package.

**Non-Goals:**

- General package management, dependency download solving, global cache reuse, or garbage collection.
- Offline repair when a remote source is unavailable.
- Detecting a moving branch or tag without an explicit operation that contacts the remote.
- Automatically discovering every Skill in a remote repository.

## Decisions

### 1. Model Git as a capability source, not a package or repository

The Workspace capability declaration gains a discriminated Git source containing `url`, `revision`, and `path`. The capability remains the identity, dependency, trust, and exposure unit. Multiple capabilities may repeat one Git source; the implementation may stage compatible acquisitions together later, but source deduplication is not a schema concern.

`source.type: repository` remains valid only for content canonically owned by a repository already in Workspace topology. It never causes acquisition.

Alternative considered: introduce `capabilityPackages`. Rejected because it exposes a transport grouping as a second domain object and complicates simple Skill installation.

### 2. Use operation-scoped staging with no persistent cache

Core exposes a staging API that clones into an operating-system temporary directory, checks out the requested revision, validates that the selected path remains within the checkout, resolves `HEAD`, validates Skill shape, and computes integrity. The API returns a staged result with an explicit cleanup lifecycle. Callers use `try/finally` so success, validation failure, copy failure, and interruption all remove staging.

Alternative considered: promote selected content into `.astrail/cache`. Rejected for the initial version because it creates duplicate durable content, cache invalidation and cleanup policy, and a second local installation state. The accepted trade-off is that repair and rollback can require network access.

### 3. Let the target plan acquisition, while core performs it

The resolved capability retains a typed source descriptor instead of only a source-type string. The Codex target compares each Git Skill declaration with its prior projection artifact. A matching owned copy with matching integrity is current; otherwise the target emits an `acquire` action that requires authorization.

During application the target asks the core staging API for validated content, atomically installs a copy, records resolved commit and integrity in its manifest, and cleans staging. This keeps Git/process/security behavior out of the target while keeping `.agents/skills` knowledge out of core.

Alternative considered: acquire during core bootstrap and re-resolve from a durable path. Rejected because it either requires a cache or leaks target-specific installed paths into the portable resolved model.

### 4. Remote projections are always copies

A Git checkout cannot be the target of a durable link because staging is deleted. Git and future registry sources therefore produce `derived-copy` artifacts regardless of the general local projection strategy. Workspace, local, Distribution, and repository-backed Skills retain existing link/copy/manifest behavior.

Installation uses a sibling temporary destination followed by rename. Astrail replaces only destinations recorded in the previous projection manifest and never removes the old copy until new content has been acquired and validated.

### 5. Separate requested source from resolved provenance

Declared configuration contains the requested URL, revision, and path. Acquisition adds resolved commit and integrity. Projection artifacts persist both so idempotent planning does not contact the network. Lock entries use an object source for Git capabilities and retain the existing compact source representation for non-Git capabilities.

Loading a lock constrains version and integrity but does not overwrite the declared requested source. A changed URL, revision, or path invalidates the prior installed projection even if the exposed alias is unchanged.

### 6. Authorization belongs to the change plan

Git acquisition actions are visible in render/bootstrap/sync dry-run output and set `requiresAuthorization: true`. Bootstrap passes its existing `--yes` authorization to projection sync. The sync command gains `--yes`; without it, plans remain inspectable but application refuses before staging or destination mutation.

Trust remains independent: network authorization permits acquisition, while instruction trust determines whether the acquired Skill may become active. A Git Skill must explicitly trust instructions before projection.

### 7. Do not poll moving references implicitly

Idempotence is based on declared source plus recorded resolved state and installed integrity. If a branch or tag name remains unchanged, ordinary status and sync do not contact the remote merely to check whether it moved. Changing the declared revision causes reacquisition. A future explicit refresh operation may support moving references without changing this contract.

## Risks / Trade-offs

- [Remote content becomes unavailable] → Lock records the resolved commit and integrity, but repair reports a network/source error because no local cache is retained.
- [A branch or mutable tag moves silently] → Recommend immutable tags or commits; ordinary sync remains deterministic and does not poll.
- [Acquisition succeeds but installation fails] → Validate fully before atomically replacing an owned destination and always clean staging.
- [Repeated source declarations cause duplicate clones] → Keep correctness simple first; add operation-local acquisition deduplication only after profiling real workspaces.
- [Existing consumers expect `ResolvedCapability.source` to be a string] → Treat the typed source descriptor as an alpha breaking API change and update CLI JSON, tests, and docs together.
- [User mistakes network approval for instruction trust] → Emit separate diagnostics and require both decisions before remote instructions are projected.

## Migration Plan

1. Extend schemas and generated types with direct Git capability sources and structured Git lock provenance.
2. Introduce typed resolved sources and core ephemeral staging with focused security and cleanup tests.
3. Update Codex planning/application to acquire and atomically copy remote Skills while preserving existing local projections.
4. Update CLI authorization plumbing, lock generation, examples, and documentation.
5. Migrate standalone remote Skill repository declarations from `repositories` to direct capability Git sources. Keep genuine business-repository-backed Skills unchanged.

Rollback removes direct Git capability declarations and their Astrail-owned projections. It does not remove or alter Workspace repositories because acquisition never places remote Skill checkouts in repository topology.
