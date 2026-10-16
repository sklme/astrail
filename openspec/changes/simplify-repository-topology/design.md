## Context

The existing resolver treats repositories as a sorted flat map and derives a local path from either `path` or `checkout.path`. Bootstrap then clones any absent non-remote-only entry with a `remote`, regardless of its declared checkout strategy. This makes invalid field combinations possible and gives a monorepo child path no relationship to its physical Git checkout. See `proposal.md` and `specs/repository-topology/spec.md` for the replacement contract.

The implementation must remain non-destructive, portable, inspectable through the existing CLI/JSON results, and independent of Git hosting vendors. Existing uncommitted repository changes are user-owned.

## Goals / Non-Goals

**Goals:**

- Make physical acquisition and logical repository roots explicit.
- Clone one physical Git checkout even when several topology nodes refer to its subdirectories.
- Preserve stable repository IDs and provenance across configuration layers.
- Keep read-only policy advisory while validating impossible parent-child permission combinations.
- Give Git, local, and subpath nodes accurate availability and observations.

**Non-Goals:**

- Git submodule initialization or nested independent Git repository orchestration.
- Sparse checkout, partial clone, pull, fetch, push, branch switching after bootstrap, or repository deletion.
- OS-level access enforcement.
- Compatibility aliases for the superseded alpha fields.

## Decisions

### 1. Use a discriminated source union

The canonical repository declaration becomes:

```yaml
repositories:
  platform:
    source:
      type: git
      url: git@example.com:team/platform.git
      revision:
        branch: main
    access: read-write
    required: true

  api:
    source:
      type: subpath
      repository: platform
      path: packages/api
    access: read-only
```

`git` owns acquisition, `local` links an existing path, and `subpath` derives from another repository. JSON Schema `oneOf` plus `additionalProperties: false` rejects mixed shapes. The legacy orthogonal fields are removed because their combinations were not independently meaningful in the runtime.

Alternative considered: retain `checkout.strategy` and add `parent`. Rejected because it preserves ambiguous combinations such as a remote-only clone strategy with a local parent.

### 2. Git placement is derived from stable identity

Git sources resolve to `<workspace>/repos/<id>` with no shared-manifest destination field. A developer who wants to use an existing checkout declares a `local` source instead. This keeps portable manifests deterministic and makes lifecycle ownership visible from the source type.

Alternative considered: configurable Git destinations in the shared or local overlay. Deferred because it reintroduces two lifecycle modes for Git sources and complicates ownership. The alpha contract favors one predictable layout.

### 3. Local paths can be supplied by the local overlay

A local source may omit `path` in the shared document so `astrail.local.yaml` can contribute `repositories.<id>.source.path`. The effective resolver emits a diagnostic if no path exists after composition. The Local Overlay schema permits only disabling a repository or overriding a local source path; it cannot switch a Git or subpath source into another type through a partial merge.

Alternative considered: require a placeholder shared path. Rejected because placeholders become valid but misleading effective values.

### 4. Resolve repository dependencies with deterministic DFS

The resolver visits active repository IDs in lexical order, recursively resolves subpath parents, caches successful results, and tracks the visiting stack. Unknown parents, cycles, unsafe paths, and access widening produce stable diagnostics. Final topology output remains sorted by repository ID, independent of traversal order.

Subpath paths must be non-empty, relative POSIX-style paths whose normalized result remains beneath the parent. The resolver performs a containment check after filesystem path resolution in addition to Schema restrictions.

Alternative considered: require parents to appear earlier in YAML. Rejected because map order is not semantic and composition can introduce repositories from several layers.

### 5. Physical and scoped observations are separate

Git and local roots use the existing physical inspection. A subpath first checks its own filesystem presence, then reads branch, HEAD, and origin from its resolved physical parent checkout. Dirty state uses a Git pathspec relative to the physical root so sibling changes do not contaminate the child observation.

The resolved repository includes `source.type`, absolute `path`, effective access, requiredness, optional parent identity, and observations. Repository origin comparison applies only to Git sources. A local source may happen to be a Git checkout, but Astrail does not treat its origin as a declared identity.

### 6. Access inheritance is intersection-like

`read-only` and `read-write` replace `read-only` and `writable`. Access remains an intent visible to agents and diagnostics, not an enforcement claim. A subpath can narrow a read-write parent to read-only. It cannot widen a read-only parent because the same physical files remain governed by the parent's stronger policy.

Alternative considered: child access always inherits and cannot be declared. Rejected because the motivating protocol-directory case needs a read-only child inside a writable monorepo.

### 7. Bootstrap acts only on Git sources

Bootstrap plans clone actions only for absent Git sources. Local and subpath nodes never produce acquisition actions. Existing destinations are preserved; origin mismatches remain warnings. Clone applies the Git source revision. Re-resolution after a parent clone makes its subpaths available without additional actions.

### 8. Trust and executable ownership remain separate

Repository trust contains only `instructions`. Declaring a root makes its content available, while repository or capability instruction trust controls Skill activation. Executable Plugin review remains in the capability/plugin lifecycle and is not inferred from repository source or access.

## Risks / Trade-offs

- [Breaking alpha manifest change] → Reject legacy fields with precise Schema diagnostics, update all bundled examples, and document the mechanical mapping.
- [A local path can point anywhere the host permits] → Keep machine-specific paths in the local overlay, expose the resolved absolute path, and never mutate local-source lifecycle state.
- [Subpath aliases can overlap] → Permit overlaps because they are useful views, but apply access widening rules and expose every resolved path clearly.
- [Parent removal invalidates children] → Report each affected child deterministically and never fall back to an incidental filesystem path.
- [Read-only remains advisory] → Continue warnings and projected guidance without claiming OS enforcement.
- [Git status on large monorepos can be expensive] → Reuse physical observations where possible and use scoped pathspec status for child roots.

## Migration Plan

1. Replace Schema and generated types, intentionally rejecting the legacy repository shape.
2. Update resolver, observation, lifecycle, CLI, target projection, import preview, examples, and fixtures together.
3. Map old declarations mechanically:
   - `remote` plus clone intent → `source.type: git`, `source.url`, and nested revision.
   - local `path` without managed acquisition → `source.type: local` and `source.path`.
   - nested logical roots → `source.type: subpath`, parent repository ID, and relative path.
   - `presence: optional` → `required: false`; other presence values require an explicit Git/local decision.
   - `access: writable` → `access: read-write`.
4. Validate all examples and fixtures, regenerate types/docs, and run the full repository check.

Rollback restores the prior Schema, resolver, fixtures, and documentation together. Bootstrap creates only reviewed clone targets, so rolling back configuration never deletes acquired repositories.
