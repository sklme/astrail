## 1. Schema and Resolved Model

- [x] 1.1 Add a discriminated direct Git capability source and structured Git lock provenance to the JSON Schemas, then verify supported and unsafe source fixtures with schema tests.
- [x] 1.2 Regenerate public TypeScript schema types and reference documentation with `pnpm schema:generate`, then verify generated files are current.
- [x] 1.3 Replace the resolved capability source string with a typed source descriptor, preserve repository path resolution, and verify capability resolution tests cover direct Git sources without repository topology entries.

## 2. Ephemeral Acquisition

- [x] 2.1 Implement core Git capability staging with revision checkout, containment checks, Skill entry validation, resolved commit capture, integrity hashing, and unconditional cleanup; verify focused success and failure tests.
- [x] 2.2 Extend lifecycle change plans and lock generation for acquisition actions and Git provenance without persistent cache state; verify dry-run, authorization, and lock tests.

## 3. Codex Projection and CLI

- [x] 3.1 Extend Codex planning to classify Git Skills as authorized managed-copy acquisitions while leaving path-backed projection strategies unchanged; verify plan and idempotence tests.
- [x] 3.2 Implement atomic acquisition-and-copy application, ownership refusal, staging cleanup, and projection provenance recording; verify successful, failed, drifted, and unowned-destination tests.
- [x] 3.3 Thread authorization through bootstrap and `sync --yes`, and expose acquisition details in human and JSON plans; verify CLI process tests.

## 4. Adoption and Verification

- [x] 4.1 Add a direct Git Skill fixture and update capability, lifecycle, security, and developer documentation to distinguish Git capabilities from business repositories; verify examples validate.
- [x] 4.2 Run focused package tests, strict OpenSpec validation, and the full workspace check, fixing only regressions within this change.
