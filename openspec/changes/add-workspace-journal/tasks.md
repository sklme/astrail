# Tasks

- [x] Implement portable Journal storage, local settings, retention and safe concurrent writes.
- [x] Capture actual mutation effects and outcomes across CLI/Core/target compound operations.
- [x] Add human and JSON list/show with repository, environment and time filters.
- [x] Update generated Agent guidance, inspection Skill, public documentation and changeset.
- [x] Verify coverage, partial failure, interruption, filtering, redaction, retention, concurrency, read-only behavior and non-fatal storage failures.
- [x] Run the complete project checks and strict validation of this change.

Validation: `pnpm check` passed with 268 tests across 26 files, including 19 Journal tests. `openspec validate add-workspace-journal --strict`, the inspection Skill validator, and Changesets release-plan inspection also passed. One full-suite run encountered simultaneous worker/process timeouts; an unchanged rerun passed without increasing test timeouts.
