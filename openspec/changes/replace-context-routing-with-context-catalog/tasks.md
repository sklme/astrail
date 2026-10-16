## 1. Schema and Generated Contracts

- [x] 1.1 Remove context `routing` and `dependsOn` from the v1alpha1 Workspace schema, regenerate TypeScript types and schema reference docs, and verify schema conformance rejects obsolete routing declarations.

## 2. Core Context Catalog

- [x] 2.1 Remove task-routing types and resolution logic while retaining deterministic catalog construction and explicit content loading, and verify Core tests cover file, glob, unavailable, secret, trust, and stable-order behavior.
- [x] 2.2 Remove routing-specific cross-reference validation and verify Workspace validation no longer expects repository or environment routing references.

## 3. CLI and Codex Projection

- [x] 3.1 Replace `context resolve|explain` with `context show <id>` and `context load <id>`, including stable unknown-context diagnostics and human/JSON tests.
- [x] 3.2 Update generated Codex guidance to instruct agents to inspect the catalog and explicitly load chosen entries, and verify target projection tests pass.

## 4. Examples, Documentation, and Follow-up Plans

- [x] 4.1 Remove routing declarations from examples and fixtures, update public documentation and migration language, and verify repository-wide search contains no supported task-routing instructions.
- [x] 4.2 Reconcile MCP and UI follow-up OpenSpec artifacts with catalog-based discovery and explicit loading, and validate each affected change strictly.

## 5. Verification

- [x] 5.1 Run focused schema, Core, CLI, and Codex target tests and verify all affected package suites pass.
- [x] 5.2 Run the full workspace check and strict validation for this change, and verify the implementation and planning artifacts are complete.
