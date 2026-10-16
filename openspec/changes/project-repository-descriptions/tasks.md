## 1. Portable repository metadata

- [x] 1.1 Preserve `description` on resolved repositories and structured inspection results, and verify resolver/type tests return the declared value without changing legacy manifests
- [x] 1.2 Add an information-level repository-addition plan diagnostic when machine input omits `description`, and verify plan/apply tests remain compatible and never synthesize text
- [x] 1.3 Add one sorted, information-level doctor diagnostic for enabled repositories without descriptions, and verify normal and strict doctor both remain successful

## 2. Human and Agent authoring

- [x] 2.1 Require a non-empty description in the interactive `repo add` prompt and carry it into the shared request, and verify CLI prompt/program tests cover the authored value
- [x] 2.2 Surface repository role and description in relevant human-readable repository plan/inspection output while preserving JSON stability, and verify CLI output tests cover described and legacy repositories
- [x] 2.3 Update the projected repository-authoring Skill to gather or clearly propose a description, show it in the JSON dry-run, and require plan authorization before apply; verify the projected Skill content test enforces this interaction

## 3. Codex project-knowledge projection

- [x] 3.1 Render deterministic repository cards with ID, role, single-line description, source, access, and requiredness in the managed `AGENTS.md` region, and verify target tests cover described and missing-description repositories
- [x] 3.2 Sanitize line breaks and managed-region marker text in projected descriptions without mutating manifest data, and verify target tests prevent description-driven instruction-block injection

## 4. Documentation and release metadata

- [x] 4.1 Document Description authoring, JSON/Agent review semantics, inspection, doctor guidance, and Codex projection, and verify documentation examples match the implemented commands and fields
- [x] 4.2 Record detailed repository-backed Context authoring and loading as a future roadmap item without implementing it, and verify the roadmap distinguishes Description from Context
- [x] 4.3 Add a patch Changeset for the affected public packages and verify Changesets recognizes the release entry

## 5. Verification

- [x] 5.1 Run focused core, CLI, and Codex-target tests for repository descriptions and verify all new behavior passes
- [x] 5.2 Run the repository-wide test, typecheck, lint/check, build, and OpenSpec strict validation commands and verify no regressions remain
