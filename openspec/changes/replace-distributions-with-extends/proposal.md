## Why

Referencing shared configuration should use the same fields as a Workspace and a familiar `extends` list. The unpublished consumer format does not need a second Distribution model, mandatory identity/version, a defaults wrapper, or an explicit no-setup declaration.

## What Changes

- Replace Distribution declarations with recursive, ordered `extends` references in Workspaces and shared configuration fragments.
- Support local files, HTTP YAML and Git repositories with an optional ref and config path; default Git entry is `astrail.config.yaml`.
- Identify and lock configs by normalized source and file, preserve source-relative paths and report cycles/conflicting Git revisions.
- Share business fields between Workspace and config schemas. Only Workspace entries require Workspace headers. Setup is optional and collected per declaring file, dependencies before dependants.
- Remove the old format and its public terminology; update CLI, Codex instructions, examples, schemas and Pages documentation together.
- Release as 0.8.0. Retain immutable historical Pages resources.

## Non-goals

No npm or builtin preset sources, additional Agent targets, automatic Skill execution, credential management, remote refresh, or compatibility alias for the removed format. This change does not publish packages or sites.

## Capabilities

### New Capabilities
- `shared-configuration`: Portable recursive config composition and setup handoff.

### Modified Capabilities
- `workspace-definition`: Shared fields and ordered source provenance.
- `workspace-lifecycle`: Source-based acquisition and locking.

## Impact

Schema, Core, CLI, Codex Target, examples, validation fixtures, OpenSpec and the separate astrail-page repository. Existing uncommitted Workspace-root changes remain untouched.
