## Implementation
- [x] 1. Define shared config, extends and lock schemas; regenerate types and validate parity.
- [x] 2. Implement normalized sources, recursive composition, source paths, conflict/cycle diagnostics and provenance.
- [x] 3. Implement validated Git/HTTP acquisition and reproducible config locking.
- [x] 4. Collect optional setup entries and update CLI/Codex output without executing Skills.
- [x] 5. Replace legacy fixtures/examples, add composition/acquisition/setup regression coverage.
- [x] 6. Update documentation, Pages resource handling and prepare version 0.8.0.
- [x] 7. Run focused and full checks, strict OpenSpec validation and Pages builds.

## Verification

- Core `pnpm check`: lint, package boundaries, fixed versions, typecheck, build, 306 tests across 30 files, and foundation OpenSpec validation passed.
- `openspec validate replace-distributions-with-extends --strict`: passed.
- Pages: 5 tests, registry resource build and release verification passed; local 0.8.0 tarball preview passed.
- Fixed package group is 0.8.0. The parent Workspace runtime and its pre-existing changes were preserved.
