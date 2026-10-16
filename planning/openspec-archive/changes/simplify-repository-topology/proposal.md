## Why

The alpha repository contract combines `path`, `remote`, checkout strategy, presence, revision, and access as loosely related fields, which permits ambiguous configurations and cannot represent a logical workspace root inside a monorepo. Astrail needs a smaller source-oriented topology that makes repository materialization and parent-child ownership deterministic.

## What Changes

- **BREAKING** Replace repository `path`, `remote`, `checkout`, `revision`, and `presence` with a discriminated `source` and a `required` boolean.
- Add `git`, `local`, and `subpath` repository source types.
- Materialize Git sources at `<workspace>/repos/<repository-id>` by default and preserve existing destinations non-destructively.
- Treat local sources as linked filesystem roots that Astrail never clones, copies, moves, or deletes.
- Resolve subpath sources beneath a declared parent repository without a second clone, validate their paths and dependency graph, and inherit Git observations from the parent while scoping dirty state to the child path.
- **BREAKING** Replace `access: writable` with the explicit advisory values `read-only` and `read-write`; a child may narrow but never widen its parent's access.
- Retain optional repository role, description, exports, and instruction trust metadata.
- Migrate examples, fixtures, generated types, CLI output, tests, and documentation to the new contract.
- Non-goals: enforcing filesystem or Git-server permissions, managing Git submodules as subpaths, automatically pulling existing repositories, or deleting repository content.

## Capabilities

### New Capabilities

- `repository-topology`: Typed Git, local, and derived subpath repository sources, advisory access, deterministic placement, observation, and non-destructive bootstrap behavior.

### Modified Capabilities

None. The prior foundation change has not been archived into main specs, so this change introduces the replacement repository-topology contract as a new delta.

## Impact

- Public `astrail.dev/v1alpha1` Workspace and Local Overlay schemas and generated TypeScript types.
- Core manifest validation, repository resolution, Git observation, diagnostics, bootstrap planning/application, and resolved result types.
- CLI repository/status JSON and tables, Codex projections, examples, fixtures, public documentation, and OpenSpec foundation language.
- Existing alpha manifests using the old repository fields require an explicit migration; no silent compatibility translation is introduced.
