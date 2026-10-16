## Why

Astrail 0.1 deliberately stops at declarative capabilities and inactive Plugin descriptors. Company-specific providers and other executable extensions need a permission model and lifecycle before Astrail can run third-party code safely.

## What Changes

- Define a versioned Plugin manifest, host API, and provider lifecycle.
- Require declared permissions, explicit trust, and reviewable activation state.
- Isolate Plugin execution from declarative Distribution and context resolution.
- Add install, inspect, activate, deactivate, and doctor workflows without silent execution.

## Capabilities

### New Capabilities

- `permissioned-plugin-runtime`: Discover, review, activate, execute, and diagnose Plugins through a versioned, least-privilege host contract.

### Modified Capabilities

- None.

## Impact

This change will add a public Plugin SDK package, core lifecycle state, CLI commands, security fixtures, and provider conformance tests. Existing declarative Workspaces remain valid and Plugins remain inactive by default.
