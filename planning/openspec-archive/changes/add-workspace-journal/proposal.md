# Proposal

## Why

Users and agents need to reconstruct recent local Workspace operations, including repository onboarding and partially completed environment checkout, without committing history or filling agent context with every command.

## What Changes

- Automatically record actual mutation effects in a bounded local JSONL Journal, with related entities, timestamps, outcomes and diagnostic codes.
- Add human and JSON `journal list` and `journal show` with repository, environment and time filters.
- Add local retention/disable settings without changing effective configuration or reviewed-plan fingerprints.
- Advertise on-demand history in generated AGENTS.md and extend the existing inspection Skill.
- Non-goals: remote synchronization, automatic undo, full workspace snapshots, arbitrary shell/code/test history, manual notes and a new standalone Skill.

## Capabilities

### New Capabilities

- `workspace-journal`: local operation recording, retention, queries and agent guidance.

### Modified Capabilities

None.

## Impact

Portable Core storage and mutation observation, local schema/types/docs, CLI command scope and query rendering, Codex projection guidance, tests, documentation and a coordinated minor changeset. No new dependencies or company-specific service.
