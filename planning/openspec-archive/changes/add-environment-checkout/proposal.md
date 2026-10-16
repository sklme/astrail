## Why

Astrail can describe environment resources but cannot express the practical multi-repository workflow in which one optional environment selects one shared branch for an explicit set of repositories. Developers and agents need a small, safe workflow for declaring, inspecting, and checking out that environment without making environments mandatory for ordinary repository development.

## What Changes

- Extend an environment declaration with an optional repository list and `checkout.branch`; environments remain optional, and repositories without an environment continue to bootstrap and develop from their declared or remote-default revision.
- Add portable core environment-authoring and checkout planning APIs with deterministic diagnostics, dry-run plans, explicit authorization, stale-plan detection, and non-destructive Git safety checks.
- Add `astrail env add`, `env status`, and `env checkout` human and JSON workflows. Interactive authoring and agent/script input share the same core request and plan contract.
- Add a Codex-targeted `astrail-environments` Skill that translates conversational intent into the same CLI JSON contract and never edits manifests or switches branches directly.
- Make repository authoring tell users that environment configuration is optional and point them to the environment workflow after repository declaration.
- Document deferred environment concepts in the product roadmap instead of implementing them now.
- Non-goals for this change: Tracks, repository sets, snapshots, promotion, branch templates, automatic Feature-environment lifecycle, per-repository branch exceptions, parallel worktrees, deployment providers, remote branch creation, fetch, pull, push, or deployment.

## Capabilities

### New Capabilities

- `environment-authoring`: Optional environment declarations and one previewable authoring contract shared by interactive and machine adapters.
- `environment-checkout`: Resolution, status, and safe local checkout of one uniform branch across an environment's repositories.
- `environment-authoring-skill`: Agent conversation guidance backed by the portable environment-authoring and checkout contracts.

### Modified Capabilities

- None. Repository topology and repository authoring remain valid without environments; the repository CLI receives only an additive follow-up hint.

## Impact

- Workspace schema and generated TypeScript declarations gain optional environment repository and checkout fields.
- `astrail-core` gains resolved environment membership plus environment authoring, status, plan, and apply APIs.
- `astrail` gains environment add/status/checkout workflows and a repository-authoring environment hint.
- `astrail-target-codex` projects an environment-management Skill through the existing target ownership model.
- Documentation, examples, roadmap, and tests cover optionality, adapter parity, safety, and deferred scope.
