---
name: astrail-skills
description: Discover Skills in declared repositories and selectively import them, or add direct Git, Workspace-relative, and repository-owned Skills through reviewed Astrail plans. Use when a user asks to find, reuse, add, install, register, link, or configure Agent Skills.
---

# Astrail Skills

Translate the user's Skill intent into Astrail's machine-readable authoring request. A Skill is stored as a `kind: skill` Capability; do not introduce a package or repository declaration for a standalone Skill remote.

## Authoring workflow

1. Collect the canonical `identity` and source. Use `astrail --json capability list` to inspect existing aliases, or `astrail --json repo list` when a repository-owned source is relevant.
2. Prepare one JSON request using a temporary file or stdin. Supported sources are:

```json
{"identity":"example/loghelper","source":{"type":"git","url":"https://example.com/team-skills.git","revision":{"tag":"v1.2.0"},"path":"skills/loghelper"}}
{"identity":"company/guide","source":{"type":"workspace","path":"skills/guide"}}
{"identity":"company/api","source":{"type":"repository","repository":"platform","path":"skills/api"}}
```

Git sources require exactly one branch, tag, or commit. Optional top-level fields are `id`, `version`, `exposeAs`, `description`, and `trust.instructions`. Let core derive `id` and `exposeAs` when the user has no preference, but make the derived values visible in the preview. Never infer `trust.instructions: trusted`; ask the user to make that trust decision.

3. Invoke `astrail --json skill add --input <request-file> --dry-run`.
4. If diagnostics are returned, explain them and adjust the request with the user. Do not patch `astrail.yaml` directly, reproduce Capability validation, or add the Git remote under Workspace repositories.
5. Present the normalized Capability, target file, actions, diagnostics, and `data.plan.planId`. Ask for explicit authorization after showing the current plan.
6. Only after confirmation, invoke the same request with `astrail --json skill add --input <request-file> --yes --plan-id <reviewed-plan-id>`.
7. Report the added Capability and explain that declaration did not clone or project it.

Never add `--yes` before the user confirms the current dry-run. If the plan ID becomes stale, preview again.

## Repository discovery and selective import

When the user asks what Skills exist in child repositories or wants to reuse repository-owned Skills, discover before proposing additions:

1. If the user names repositories, invoke `astrail --json skill discover --repository <id>` once per selected ID. Otherwise invoke `astrail --json skill discover --all`.
2. Present each candidate's repository, path, name, proposed identity and alias, trust state, existing declaration, and conflicts. Discovery is read-only and does not expose a Skill.
3. Ask the user to choose an explicit subset whenever more than one candidate is available or the request does not already identify exact candidates. Preserve every unselected candidate.
4. Resolve reported identity, ID, or alias conflicts with the user. Never infer `trust.instructions: trusted`; repository trust is informational, and per-Capability trust still requires an explicit decision when needed.
5. Prepare one selection request containing exactly the chosen candidates:

```json
{
  "selections": [
    {
      "repository": "platform",
      "path": ".agents/skills/api",
      "identity": "company/platform-api",
      "exposeAs": "platform-api",
      "trust": { "instructions": "trusted" }
    }
  ]
}
```

`identity`, `id`, `exposeAs`, `version`, `description`, and `trust` are optional reviewed overrides. Omit them to use the candidate defaults shown by discovery.

6. Invoke `astrail --json skill import --input <selection-file> --dry-run`. Present every normalized Capability addition, target file, action, diagnostic, and `data.plan.planId`.
7. Only after explicit confirmation, invoke the same request with `astrail --json skill import --input <selection-file> --yes --plan-id <reviewed-plan-id>`.
8. When this workflow follows `repo add`, use the structured `data.repositorySkills.candidates` as a discovery hint but still rerun `skill discover` before planning import. This detects changes between repository authoring and selection. Treat `data.nextSteps` as guidance, never as mutation authorization.
8. Report exactly which Skills were imported. Import writes ordinary Capability declarations only; it does not clone, trust, or project content.

Do not patch `astrail.yaml` directly, persist discovery output, import every candidate by default, or turn a business repository into a Skill package. If candidates or their `SKILL.md` files change, discard the stale plan and discover again.

## Installation

Treat acquisition and projection as a separate action. Only when the user explicitly asks to install or synchronize the Skill, run `astrail --json sync --dry-run`, present its network and file actions, and obtain a separate authorization before `astrail --json sync --yes`.
