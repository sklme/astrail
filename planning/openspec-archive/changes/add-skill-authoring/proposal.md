## Why

Skills can now be declared from direct Git, Workspace, or repository-owned sources, but users and agents still have to edit capability YAML by hand. A shared Skill-authoring use case gives the interactive CLI and agent conversation the same previewed, validated, non-destructive path used for repository authoring without introducing another configuration layer.

## What Changes

- Add a portable core API that normalizes a Skill request into a `kind: skill` Capability declaration, validates it through normal Workspace resolution, and produces a deterministic dry-run plan before writing manifests.
- Add an authorized apply operation that detects stale plans, preserves unrelated YAML content, verifies the composed Capability, and restores original content after a failed verification.
- Add `astrail skill add` with an interactive terminal workflow and a stable `--input <file|-> --dry-run --json` contract for agents and scripts.
- Support direct Git, Workspace-relative, and declared-repository Skill sources in the initial authoring workflow.
- Add a Codex-targeted `astrail-skills` Agent Skill that collects intent, invokes the machine contract, presents the exact plan, and applies only after explicit confirmation.
- Keep declaration separate from acquisition and projection: `skill add` writes configuration only, while `sync --dry-run` and `sync --yes` remain separate operations.
- Keep Capability as the only persisted domain object; `skill add` is an authoring view and does not add a top-level Skill package, repository, or cache model.
- Non-goals: updating or removing existing Capabilities, discovering every Skill in a remote repository, local-overlay path splitting, registry installation, or implicit network access.

## Capabilities

### New Capabilities

- `skill-authoring`: Previewable and verifiable creation of Skill Capability declarations shared by interactive and machine-facing adapters.
- `skill-authoring-skill`: Agent conversation guidance for collecting Skill intent and invoking the portable authoring contract safely.

### Modified Capabilities

- None. Existing Capability resolution and direct Git acquisition semantics are consumed without changing their contracts.

## Impact

- `astrail-core` gains Skill authoring request, plan, apply, targeted YAML editing, and composed verification APIs.
- `astrail` gains an interactive and machine-readable `skill add` command plus terminal prompting.
- `astrail-target-codex` ships and projects the built-in `astrail-skills` Agent Skill alongside repository authoring.
- Tests cover normalization, source validation, plan identity and staleness, YAML preservation, CLI parity, authorization, and built-in Skill projection.
- Documentation gains a reviewed Skill addition workflow; existing manifests remain compatible.
