## Context

See proposal.md for motivation. Repository authoring currently writes manifests only; bootstrap prepares all repositories and Distributions and projects Codex artifacts. Reusing the full bootstrap command would exceed the reviewed addition's scope.

## Goals / Non-Goals

**Goals:** Compose manifest authoring with narrowly scoped repository preparation, preserve exact-plan review, and expose partial completion and retry.

**Non-Goals:** Change bootstrap's public interface, synchronize unrelated artifacts, import all Skills, or implicitly trust repository instructions. Skill import retains its existing reviewed selection workflow; automatic import-and-sync is outside this change.

## Decisions

- Add request `prepare: false` and CLI `--no-prepare` as explicit declaration-only opt-outs. Default preparation is a documented behavior change.
- Implement preparation in portable core using the existing topology resolver and Git helpers, independent of CLI or target code. The repository plan combines file writes with preparation actions and snapshots of effective configuration and selected destinations.
- Follow only source ancestors for subpaths. Observe and validate existing Git origin/revision without switching branches, resetting, or modifying user changes. Missing local sources fail preparation validation; missing subpaths below a planned clone are checked after clone.
- Compare normalized repository declarations with effective defaults to allow identical retries; differences remain conflicts. Snapshot effective configuration even for no-write retries to detect ancestor/local override changes.
- Keep the operation lock across registration and preparation, but separate failure handling: manifest write/verification failures restore manifests; preparation failures preserve registration. Return explicit preparation status and remediation to repeat the request with a fresh plan.
- Clone into an owned temporary directory and only publish a complete checkout into an unoccupied destination. Clean up only the temporary directory created by this attempt. This prevents failed pinned-revision checkout from leaving a misleading completed destination.
- Run discovery after successful preparation (or on available declaration-only repositories). Human terminals offer optional import by default; JSON returns candidates and next steps. Preserve the existing import selection and trust boundary; no global sync is chained.

## Risks / Trade-offs

- Default clone adds network activity → dry-run exposes the destination and revision; old plan IDs cannot authorize the expanded plan; declaration-only mode remains available.
- Registration and clone are not one atomic filesystem transaction → report registration and preparation separately, retain configuration on clone failure, and provide idempotent retry.
- Other processes can edit configuration or destinations → revalidate reviewed snapshots under the workspace operation lock and check the destination before publishing; never remove existing user directories.
- Existing workflows depend on declaration-only behavior → update fixtures and document the opt-out rather than making tests depend on external remotes.

## Migration Plan

Ship core, CLI, and projected repository Skill together. Existing workspaces receive the revised Skill through their normal Astrail synchronization. Old explicit bootstrap workflows remain supported. No manifest schema migration is needed because preparation is request intent, not persistent repository metadata.
