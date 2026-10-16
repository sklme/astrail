# Tasks

- [x] Implement deterministic inferred filenames and preserve explicit overrides.
- [x] Preserve managed legacy content with existing safety and stale-plan guards.
- [x] Update Schema metadata, generated types, editor documentation, and Changeset.
- [x] Verify core naming/migration and CLI lifecycle/open regression tests.
- [x] Run the repository check, strict change validation, and documentation build.

Validation: all 331 tests passed across the full run and the retry of two HTTP test files outside the sandbox (the initial run denied localhost listeners). Template, lint, boundary, version, typecheck, build, foundation/change validation, and astrail-page documentation build checks passed.
