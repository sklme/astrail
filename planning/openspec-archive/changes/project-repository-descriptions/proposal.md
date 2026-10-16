## Why

Repository declarations can already carry a description, but interactive authoring does not ask
for it, resolved topology drops it, and Codex projection omits it. As a result, agents see which
repositories exist without learning what each repository owns or why it matters.

## What Changes

- Carry repository descriptions through the portable resolved workspace and structured inspection
  APIs.
- Ask humans for a concise repository description during `repo add`, while preserving the existing
  machine request field and plan/apply safety contract.
- Make Agent repository authoring explicitly propose and review descriptions through the same JSON
  request contract; never infer or apply a description without showing it in the plan.
- Render repository role and description in the concise Astrail-managed `AGENTS.md` repository
  catalog.
- Report existing repositories without descriptions as informational project-knowledge gaps without
  making the workspace unhealthy.
- Keep detailed repository-backed Context discovery, authoring, and loading out of scope for this
  change; those remain a future roadmap item.

## Capabilities

### New Capabilities

- `repository-description-projection`: Author, resolve, inspect, diagnose, and project concise
  repository descriptions consistently for human and Agent workflows.

### Modified Capabilities

None.

## Impact

This changes the Workspace resolved types, repository authoring prompts and structured results,
workspace inspection diagnostics, Codex managed instructions and projected repository Skill, plus
their tests and documentation. The manifest schema remains backward compatible because repository
descriptions stay optional for existing workspaces; no company-specific behavior or Context model
is introduced.
