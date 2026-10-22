---
name: astrail-repositories
description: Add and prepare Astrail Git repositories, linked local directories, or monorepo subpaths, then offer repository Skill import. Use when a user asks to add, register, link, or configure a repository in an Astrail workspace.
---

# Astrail Repositories

Translate the user's repository intent into Astrail's machine-readable authoring request. Keep questions focused on information that cannot be inferred safely.

## Authoring workflow

1. Run `astrail --json repo list` when existing repositories or a subpath parent are relevant.
2. Gather a concise, non-empty responsibility description for the repository. Prefer the user's
   wording. You may derive a proposed description from the user's request or inspected repository
   documentation, but clearly label it as a proposal. If there is not enough evidence to explain
   what the repository owns, ask the user for a description instead of fabricating one.
3. Prepare one JSON request using a temporary file or stdin. Include the reviewed or proposed
   `description` in the request. Supported sources are:

```json
{"description":"Owns the service API and its deployment configuration.","source":{"type":"git","url":"https://example.com/team/service.git"}}
{"id":"reference","description":"Provides local product reference material.","source":{"type":"local","path":"/absolute/reference/path"}}
{"id":"api","description":"Implements the platform API package.","source":{"type":"subpath","repository":"platform","path":"packages/api"}}
```

Optional top-level fields are `id`, `access`, `required`, `role`, `trust.instructions`, and
`writeTarget`, and `prepare`. Preparation defaults to enabled: the reviewed addition also clones
missing managed Git sources and verifies local or subpath sources. Use `prepare: false` only when
the user explicitly wants declaration only. Let core defaults apply when the user has no preference. Make an inferred ID visible
in the preview. Description is part of the repository intent and must be present in the JSON
dry-run even when its text is still a clearly labelled proposal.

4. Invoke `astrail --json repo add --input <request-file> --dry-run`.
5. If the command reports diagnostics, explain them and adjust the request with the user. Do not patch `astrail.yaml` or `astrail.local.yaml` directly and do not reproduce topology validation yourself.
6. Present the returned repository, including the exact planned `description`, selected manifest
   targets, file actions, clone destinations and revisions (including any source ancestors), and
   `data.plan.planId`. Explain that confirmation covers registration and these preparation actions.
   Continue to label an Agent-derived description as
   proposed while showing the returned plan. Ask for explicit authorization of that returned plan
   and wait for the user's response.
7. Only after that authorization, invoke the same request with `astrail --json repo add --input <request-file> --yes --plan-id <reviewed-plan-id>`.
8. Inspect `data.applied` and `data.preparation.status` first. `applied: true` means registration
   completed; preparation can still be `failed`. If it failed, explain the reported cause and the
   preserved registration. Fix an actionable problem within the user's scope, then preview the same
   request again. Identical declarations are reused; conflicting configuration is not overwritten.
   Do not repeatedly retry unchanged authentication, network, or destination failures.
9. After preparation succeeds, inspect `data.repositorySkills`, `data.nextSteps`, and any `ASTR8014`
   information diagnostic. Report relevant discovered, unimported, importable, and unavailable-repository
   counts. Do not discard candidate paths, conflicts, or trust state when presenting the result.
10. If importable Skills exist, proactively offer selective import in the same conversation; do not
    wait for the user to initiate another task. Show the candidates and let the user choose or skip.
    Use `$astrail-skills` to refresh discovery, build an explicit selection file, preview
    `astrail --json skill import --input <selection-file> --dry-run`, and apply the authorized import
    plan. Never infer instruction trust from permission to clone. After import, preview install
    separately when requested. If no Skills are available, finish without an import question.
11. Report whether the repository is ready, declaration-only, or still awaiting preparation. A skipped
    import does not undo successful repository addition. Unavailable-repository counts are not proof
    that a repository contains no Skills.

Never add `--yes` before the user confirms the current dry-run. If the plan ID becomes stale, preview again instead of bypassing the check.

`repo add --import-skills` remains a human-terminal compatibility option; interactive `repo add`
now offers Skill selection by default after preparation, with an option to skip. Do not use it with `--json` or `--input`;
Agent workflows must preserve machine-readable selection, plan-ID review, and separate import authorization.

Environment configuration is optional. After adding a repository, mention `$astrail-environments` when the user wants several repositories to share one environment branch; do not create or change an environment automatically.

## Preparation and retries

The reviewed `repo add` plan already includes preparation. Continue through its execution without
asking for another clone request or confirmation. Do not chain workspace-wide install or update;
they can affect unrelated repositories and artifacts.

To prepare a declaration-only repository later, repeat its addition request without `prepare: false`
or `--no-prepare`, review the resulting plan, and apply it. To recover a failed clone, use the same
request and a fresh plan ID. An existing valid checkout is verified and reused without resetting,
switching branches, or discarding local changes. Resolve conflicting declarations or occupied
destinations with the user instead of overwriting them.
