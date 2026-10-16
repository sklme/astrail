## Why

Publishers need to share a single Distribution YAML through static hosting while keeping Skills in their existing Git repositories. Every Distribution should explicitly explain whether it needs Agent-led setup, without making the CLI execute Skills or manage credentials.

## What Changes

- Add HTTP(S) single-file Distribution sources alongside existing local directories and Git repositories.
- Acquire manifests only during authorized bootstrap; inspection and previews use cached data without network access.
- Add a standard setup declaration: a canonical Skill identity or explicit `mode: none`. Keep legacy omissions readable with an informational migration diagnostic.
- Report setup entries and absolute projected Skill paths in bootstrap results. Configuration availability never means setup or authentication completed.
- Document all three source types, caching, version selection, and static publication.

## Non-goals

No Registry, credential storage, arbitrary setup hooks, generic MCP projection, automatic Skill execution, or automatic remote refresh.

## Capabilities

### New Capabilities

- `distribution-onboarding`: Static manifest acquisition and declarative Agent setup handoff.

## Impact

Workspace and Distribution schemas, core loading/acquisition/lock provenance, bootstrap JSON and human output, Codex guidance, examples, and documentation change. Existing local and Git declarations remain supported.
