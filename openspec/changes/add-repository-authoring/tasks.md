## 1. Core Authoring Contract

- [x] 1.1 Add typed repository-addition request, normalized plan, file change, and apply result models to `astrail-core`, verified by TypeScript build.
- [x] 1.2 Implement source normalization, deterministic defaults, manifest target selection, duplicate detection, and topology diagnostics, verified by focused core planning tests for Git, local, and subpath sources.
- [x] 1.3 Implement targeted YAML edits, stable plan identifiers, stale-plan detection, locked apply, rollback, and post-apply composed verification, verified by core mutation tests that preserve comments and reject concurrent changes.

## 2. CLI Adapters

- [x] 2.1 Add `astrail repo add --input <file|-> --dry-run --json` and authorized `--plan-id` apply behavior, verified by CLI tests for structured preview, apply, refusal, and invalid input.
- [x] 2.2 Add an injectable interactive repository wizard with source-specific questions, defaults, plan preview, and confirmation, verified by adapter-parity and cancellation tests.

## 3. Agent Skill Projection

- [x] 3.1 Author the target-owned `astrail-repositories` Skill with Git, local, and subpath conversation flows and strict delegation to CLI JSON planning/apply, verified by content assertions.
- [x] 3.2 Include the meta Skill in Codex projection ownership for link, copy, and manifest strategies, verified by target projection and doctor tests.

## 4. Documentation and Verification

- [x] 4.1 Document repository authoring examples, manifest targeting, CLI human/machine flows, and separate bootstrap behavior, verified by documentation review and command examples.
- [x] 4.2 Run formatting, lint, boundary, typecheck, package tests, build, and strict OpenSpec validation; fix every scoped failure and record all tasks complete.
