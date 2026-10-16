## Why

Remote Skills are capability dependencies, not business repositories. Modeling a standalone Skills Git repository in Workspace topology pollutes repository status and lifecycle semantics, while a separate package or persistent cache layer adds complexity before Astrail has evidence that it is needed.

## What Changes

- **BREAKING** Add a direct `git` capability source so a capability owns its remote URL, requested revision, and content subpath without declaring that source as a Workspace repository.
- Acquire Git capability content through an ephemeral staging checkout, validate the selected Skill, copy it atomically into the target-owned projection, and remove staging state after the operation.
- Do not introduce a top-level capability package model or a persistent capability cache; configuration, lock state, and target projection remain the only durable states.
- Record the requested revision, resolved Git commit, selected path, and content integrity in lock and projection metadata.
- Keep `repository` capability sources only for capabilities canonically owned by repositories already present in Workspace topology.
- Make acquisition previewable and require explicit authorization for network access; never update or delete business repositories as part of capability acquisition.
- Treat remote Git Skill projection as a managed copy. Local, Workspace, and repository-owned Skills may continue to use links where supported.
- Non-goals: registry protocol design, global cache management, automatic remote polling, Plugin execution, and implicit Skill discovery from arbitrary repository contents.

## Capabilities

### New Capabilities

- `capability-acquisition`: Direct, temporary, lockable acquisition of remote Git capabilities without adding their source repositories to Workspace topology or retaining a persistent capability cache.

### Modified Capabilities

None. The earlier foundation capability-resolution contract has not been archived into the main specification set.

## Impact

- Workspace, lock, and generated TypeScript schemas for capability source and resolved acquisition metadata.
- `astrail-core` capability resolution, lifecycle planning/application, integrity, trust, and lock behavior.
- `astrail-target-codex` projection planning and ownership behavior for acquired Skills.
- CLI bootstrap, sync, update, status, diagnostics, and dry-run output.
- Capability fixtures, tests, examples, and author/developer documentation.
