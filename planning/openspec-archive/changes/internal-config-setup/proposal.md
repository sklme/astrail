## Why

Shared config setup currently appears in the daily Skill list because the Codex target projects it like any other Skill. Initialization can also stop after bootstrap, leaving the user to request the setup separately.

## What Changes

- Prepare Skills referenced by `setup.skill` under `.astrail/setups/<alias>/`, with their supporting files, outside `.agents/skills/`.
- Include actionable Agent instructions in bootstrap JSON and human output and generated Workspace guidance. An initialization request includes completing available setup entries in dependency order.
- Migrate owned legacy projections, reuse verified Git copies locally, and preserve modified or unowned paths with diagnostics.
- Keep the existing config schema, instruction trust, integrity checks, and CLI execution boundary. Omitted setup and `mode: none` add no entry and do not cancel dependency setup.

## Impact

Changes affect `astrail-target-codex`, the CLI, the inspection Skill, and the shared-config documentation in astrail-page. Setup paths change and bootstrap entries gain an optional `instruction` field. Existing manifests need no edits. The behavior ships in 0.9.0; existing Workspace runtime upgrades remain explicit.
