## 1. Core Discovery

- [x] 1.1 Add typed discovery scope, candidate, metadata, trust, conflict, and result contracts to `astrail-core`, and verify public type exports compile.
- [x] 1.2 Implement shallow convention scanning for selected or all resolved repository roots with safe path and symlink containment, deterministic ordering, frontmatter parsing, fingerprints, and no mutation; verify focused tests cover local, Git-present, subpath, unavailable, unknown, malformed, and duplicate physical candidates.
- [x] 1.3 Add existing-declaration and identity/ID/alias conflict analysis to candidates, and verify tests cover already imported Skills and cross-repository collisions.

## 2. Selective Batch Import

- [x] 2.1 Add selection normalization and validation that reuses Skill authoring rules and only accepts current importable discovery candidates; verify tests cover subsets, overrides, duplicate selections, escaping paths, unknown repositories, already-declared sources, and resolved conflicts.
- [x] 2.2 Implement deterministic batch import preview with exact YAML preservation, source fingerprints, one plan ID, and ordinary Capability additions only; verify no files change during preview.
- [x] 2.3 Implement locked atomic apply with manifest and source staleness checks, composed verification, and rollback; verify tests cover success, stale manifest, stale `SKILL.md`, mismatched plan ID, and partial-verification refusal.

## 3. CLI and Agent Adapters

- [x] 3.1 Add `astrail skill discover` repository/all scopes with deterministic human output and stable JSON output, and verify CLI process tests cover scoped, all, unavailable, unknown, and non-interactive behavior.
- [x] 3.2 Add interactive `astrail skill import` numbered multi-selection plus machine `--input`, `--dry-run`, `--yes`, and `--plan-id` flow, and verify CLI process tests cover selective preview, authorization refusal, atomic apply, and no implicit synchronization.
- [x] 3.3 Extend the built-in `astrail-skills` Agent Skill with discovery, explicit subset selection, reviewed import, trust boundaries, and separate synchronization guidance; verify target tests assert the required commands and authorization language.

## 4. Documentation and Verification

- [x] 4.1 Document supported child-repository layouts, discovery/import examples, conflict/trust behavior, and CLI/Agent parity; verify documentation links and examples match the shipped command surface.
- [x] 4.2 Run formatter, typecheck, focused and full test suites, package build, and `openspec validate add-skill-discovery-import --strict`; fix all regressions and record every task complete.

## 5. Repository and Inspection Continuity

- [x] 5.1 Return structured repository Skill inventory and Agent next steps after repository apply, while representing unavailable repositories without failing successful authoring.
- [x] 5.2 Add human-only `repo add --import-skills` continuation through selective import, per-Skill trust, reviewed import confirmation, and separate synchronization guidance.
- [x] 5.3 Report unimported repository Skills from bootstrap and doctor as structured informational findings; update human rendering, Agent Skills, docs, and end-to-end tests.
