## Why

Confirming repository addition currently writes a declaration but leaves a new Git repository missing. Users must separately request bootstrap before Skill discovery can work, so the normal addition workflow stops before the repository is usable.

## What Changes

- **BREAKING**: `repo add` defaults to registering and preparing the selected repository under one reviewed plan; explicit declaration-only requests remain supported.
- Include clone destinations and requested revisions in the preview and plan ID, with preparation limited to the selected repository and its required source ancestors.
- Reuse identical declarations for retries; reject conflicting declarations without overwriting them. Report registration and preparation outcomes separately.
- Scan Skills after preparation and offer selective import in human terminals and Agent conversations; machine mode remains non-interactive.
- Preserve bootstrap's public interface and existing workspace-wide behavior. Do not add a new preparation command or automatically trust/import Skills or synchronize unrelated artifacts.

## Capabilities

### New Capabilities
- `repository-onboarding`: Complete, scoped repository addition, recoverable preparation, and post-preparation Skill discovery.

### Modified Capabilities

None. Existing repository-authoring and discovery specifications are still unarchived changes; this capability defines the new integrated behavior.

## Impact

Portable core repository planning and Git preparation, CLI repository commands and output, projected Codex repository Skill, documentation, and regression tests. No company-specific integration or additional runtime dependency is required.
