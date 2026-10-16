## Why

Repository topology is now expressive enough to describe managed Git repositories, linked local directories, and monorepo subpaths, but users still have to understand and edit the manifest format directly. A shared repository-authoring use case will let both an interactive CLI and an agent conversation reduce that configuration burden without duplicating policy or mutating workspace files inconsistently.

## What Changes

- Add a portable core API that normalizes repository input, validates topology rules, and produces an attributable dry-run plan before changing manifests.
- Add an explicit apply operation that safely updates the shared or local workspace manifest and verifies the composed result.
- Add `astrail repo add` with an interactive terminal wizard for people and a stable JSON input/output mode for agents, scripts, and future adapters.
- Add a Codex-targeted repository-management Skill that translates natural-language intent into the non-interactive CLI contract, previews the plan, and applies it only after authorization.
- Keep repository declaration separate from repository materialization; cloning remains an explicit bootstrap step.
- Preserve portable core behavior and avoid company-specific repository assumptions or agent-vendor dependencies.

## Capabilities

### New Capabilities

- `repository-authoring`: Previewable and verifiable repository additions shared by interactive and machine-facing adapters.
- `repository-authoring-skill`: Agent conversation guidance for collecting repository intent and invoking the portable authoring contract safely.

### Modified Capabilities

- None. Existing repository-topology semantics remain unchanged and are consumed by the new authoring capability.

## Impact

- `astrail-core` gains repository authoring request, plan, and apply APIs plus safe manifest mutation support.
- `astrail` gains an interactive `repo add` workflow and non-interactive JSON contract.
- `astrail-target-codex` projects a repository-management Skill backed by the CLI JSON contract.
- Tests cover adapter parity, dry-run behavior, manifest targeting, topology validation, and preservation of user-owned configuration.
- Existing repository schema remains compatible; this change adds authoring behavior rather than new repository fields.
