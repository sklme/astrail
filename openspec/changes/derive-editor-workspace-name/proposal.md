# Proposal

## Why

Every Workspace currently defaults to `astrail.code-workspace`, making editor windows and recent workspaces difficult to distinguish despite existing Workspace names.

## What Changes

- Keep explicit `editor.workspaceFile` overrides first; otherwise use `metadata.name`, then a usable root directory basename, then `astrail` as the filename stem.
- Preserve existing validation and portable root-level filenames.
- When creating the new default, copy content and folder ownership from a managed legacy `astrail.code-workspace`, retaining the original file and respecting an existing destination.
- Update Schema descriptions and editor documentation. This does not change `metadata.displayName`, relax manifest validation, rename arbitrary existing files, or launch an editor.

## Capabilities

### Modified Capabilities

- `editor-workspace`: default filename derivation and legacy content preservation.

## Impact

Portable core editor planning, Schema metadata and generated types, CLI lifecycle/open regression tests, and astrail-page editor documentation. No company-specific integration changes.
