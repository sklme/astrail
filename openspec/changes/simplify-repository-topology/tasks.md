## 1. Schema and Types

- [x] 1.1 Replace the Workspace repository contract with required access, requiredness, instruction trust, and the `git | local | subpath` source union; regenerate TypeScript/schema docs and verify schema generation plus typecheck pass.
- [x] 1.2 Restrict the Local Overlay to repository disablement and local-source path overrides, and verify manifest tests cover valid overrides and rejected legacy fields.

## 2. Resolution and Observation

- [x] 2.1 Implement deterministic repository dependency resolution, default Git placement, local paths, subpath containment, unknown-parent/cycle diagnostics, and access narrowing; verify focused resolver/manifest tests cover each branch.
- [x] 2.2 Implement physical Git observation and subpath-scoped dirty observation, and verify tests distinguish child changes from sibling changes.
- [x] 2.3 Update resolved repository types, capability source path resolution, CLI/target consumers, and diagnostics for the new contract; verify package typechecks pass.

## 3. Lifecycle and Migration

- [x] 3.1 Update bootstrap planning/application to clone only missing Git sources into `repos/<id>` with revision selection and never materialize local or subpath sources; verify lifecycle tests cover preview, authorization, idempotence, and parent-child availability.
- [x] 3.2 Update bundled fixtures to use the new source/access/required contract; verify conformance tests pass.

## 4. Documentation and Validation

- [x] 4.1 Update examples and public documentation with Git, local, and monorepo subpath configurations plus explicit migration guidance; verify repository-wide search finds no supported legacy declarations.
- [x] 4.2 Reconcile the completed foundation planning language with the replacement contract and verify both OpenSpec changes pass strict validation.
- [x] 4.3 Run formatting, boundaries, typecheck, full tests, build, Schema generation cleanliness, and diff checks; verify every command succeeds before completing the change.
