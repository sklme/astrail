## Why

Local and Git sources are sufficient for Astrail 0.1, but reusable public ecosystems and organization-specific Workspace distributions need discovery, authenticity, compatibility, and policy composition.

## What Changes

- Define registry discovery and metadata protocols for Distributions, capabilities, and Plugins.
- Add signatures, publisher identity, integrity verification, and compatibility reports.
- Define organization policy packs as advisory configuration and diagnostics.
- Preserve explicit installation and trust decisions; recommendations never auto-install artifacts.

## Capabilities

### New Capabilities

- `artifact-registry`: Discover and verify versioned Astrail artifacts with compatibility metadata.
- `organization-policy-packs`: Compose namespaced advisory policies and report their provenance and compatibility.

### Modified Capabilities

- None.

## Impact

This change will add registry client interfaces, signing metadata, policy-pack schemas, CLI discovery commands, cache behavior, and offline/security conformance tests.
