## Why

Once Astrail core and CLI result contracts stabilize, a visual control plane can make topology, provenance, context catalogs, recommendations, and change previews easier to understand without becoming a separate source of truth.

## What Changes

- Add a local UI backed exclusively by public `astrail-core` application APIs.
- Visualize declared, resolved, observed, and lock state as distinct layers.
- Let users inspect context metadata and explicitly open a source without presenting task-routing decisions.
- Provide read-only inspection first, followed by reviewable plan application.
- Keep generated edits round-trippable through the same schemas and diagnostics as the CLI.

## Capabilities

### New Capabilities

- `control-plane-ui`: Inspect and review Astrail workspace state and lifecycle plans through a local graphical interface.

### Modified Capabilities

- None.

## Impact

This change will add a UI package, an API bridge over typed core results, interaction tests, accessibility requirements, and documentation. It will not add an independent resolver or persistence model.
