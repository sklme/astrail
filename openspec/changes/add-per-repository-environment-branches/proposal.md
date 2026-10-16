# Proposal

## Why

An environment currently forces every repository onto the same branch. Real workspaces combine repositories with different default or feature branches, and splitting one working environment into several environments obscures that relationship.

## What Changes

- Support optional `checkout.branches` overrides keyed by environment repository ID, with `checkout.branch` retained as an optional fallback.
- Permit mappings without a fallback when every member has a target branch.
- Resolve, preview, check status, and switch each physical checkout to its own target; reject conflicting targets for members sharing a physical checkout.
- Extend machine and interactive environment authoring, human/JSON inspection, documentation, and regression tests.
- Preserve existing shared-branch declarations and checkout authorization/safety behavior. Branch creation, fetching, automatic root repository registration, and environment updates are out of scope.

## Capabilities

### New Capabilities

- `per-repository-environment-branches`: Branch selection and authoring for heterogeneous environments, extending the unarchived environment-checkout implementation.

### Modified Capabilities

None; the repository has no archived main specs yet.

## Impact

Portable schema, generated types, core environment resolution/authoring/checkout, CLI, and bundled environment skill. No company-specific integration or new dependency is required.
