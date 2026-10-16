## 1. Core repository completion

- [x] 1.1 Compose scoped preparation into repository plans, including declaration-only mode and stale-plan checks; verify core tests with local Git fixtures.
- [x] 1.2 Preserve registration on preparation failure and support identical retries without overwrites; verify failure, retry, existing-checkout, and subpath cases.

## 2. CLI and Agent workflow

- [x] 2.1 Expose preparation outcomes and declaration-only option, and offer optional terminal Skill import after preparation; verify CLI integration tests and JSON non-interactivity.
- [x] 2.2 Update repository Skill and authoring documentation for one-confirmation completion and retries; validate the Skill and review examples against the CLI contract.

## 3. Integration verification

- [x] 3.1 Run focused tests, full pnpm check, and strict change validation; resolve regressions and record outcomes.

Verification: focused core/CLI tests passed; final `pnpm check` passed all lint, boundary, version,
typecheck, build, and 114 tests across 18 files. Used `pnpm_config_verify_deps_before_run=false`
to use installed dependencies without pnpm's automatic reinstall. Strict validation of this
change and the repository Skill validator passed. Git diff whitespace checks passed.
