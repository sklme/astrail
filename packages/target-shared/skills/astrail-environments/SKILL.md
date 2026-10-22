---
name: astrail-environments
description: Add, inspect, or check out optional Astrail environments through reviewed plans. Use when a user wants to coordinate branches across workspace repositories using a shared default or per-repository targets.
---

# Astrail Environments

Translate environment intent into Astrail's structured commands. Environments are optional: a Workspace without them continues ordinary repository development from declared or remote-default revisions.

## Add an environment

1. Use `astrail --json repo list` and `astrail --json env list` to inspect valid identifiers.
2. Prepare a JSON request with an explicit environment ID, repository list, and branch targets:

```json
{"id":"feature-a","repositories":["frontend","backend"],"branch":"feature/a","branches":{"backend":"feature/api"}}
```

`branch` is the optional default; `branches` maps member IDs to overrides. Omit `branches` for a shared branch, or omit `branch` when every member has an override. Override keys must belong to the environment. Other optional fields are `description`, `provider`, and `resources`. Do not infer repository membership when the user has not identified it safely. The workspace root is not automatically a registered repository named `workspace`.

3. Run `astrail --json env add --input <request-file> --dry-run` and present the normalized environment, diagnostics, file action, and `data.plan.planId`.
4. After explicit confirmation of that plan, run the same request with `astrail --json env add --input <request-file> --yes --plan-id <reviewed-plan-id>`.

Use the structured `branches` field for per-repository targets. Do not patch Astrail manifests directly. If the plan is stale or rejected, preview again. Older versions including 0.2.0 do not support branch maps; explain the required upgrade instead of silently splitting a single requested environment.

## Inspect or check out

Use `astrail --json env status <id>` for read-only consistency. Inspect each repository's `desiredBranch`; the environment-level value is only the default. Members sharing a physical Git checkout must resolve to the same branch. Explain conflicting targets before proposing checkout. Adding an environment does not switch branches.

When the user asks to switch repositories:

1. Run `astrail --json env checkout <id> --dry-run`.
2. Present every no-op or switch action, safety diagnostic, and `data.plan.planId`.
3. Obtain separate explicit confirmation for the Git mutation.
4. Run `astrail --json env checkout <id> --yes --plan-id <reviewed-plan-id>`.

Never run Git switch, fetch, pull, push, branch creation, deletion, or deployment commands directly as a substitute. Explain dirty checkout or missing local branch diagnostics and let the user prepare the repository explicitly.
