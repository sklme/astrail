## 1. Core Skill Authoring

- [x] 1.1 Add typed Skill addition request, normalized plan, file change, and apply result APIs in `astrail-core`; verify unit tests cover Git, Workspace, and repository sources plus deterministic ID and alias defaults.
- [x] 1.2 Implement source-field, revision, safe-path, duplicate ID, alias, repository-reference, and instruction-trust validation; verify invalid requests produce structured diagnostics without file actions.
- [x] 1.3 Implement targeted Capability YAML planning and authorized apply with plan-ID checks, stale-file refusal, atomic writes, composed verification, and rollback; verify comments and unrelated fields are preserved and no acquisition occurs.

## 2. CLI Adapters

- [x] 2.1 Add `astrail skill add` machine mode with `--input`, `--dry-run`, `--yes`, and `--plan-id`; verify JSON process tests cover preview, refusal, apply, stale or mismatched plans, and non-interactive diagnostics.
- [x] 2.2 Add the interactive Skill prompter for Git, Workspace, and repository sources using the same core request contract; verify adapter tests cover equivalent plans and cancellation without mutation.

## 3. Codex Agent Skill

- [x] 3.1 Create `packages/target-codex/skills/astrail-skills` with focused `SKILL.md` and UI metadata following the skill-creator workflow; verify `quick_validate.py` passes.
- [x] 3.2 Generalize built-in Codex Skill projection to include repository and Skill authoring entries with identical ownership behavior; verify target tests cover discovery, instructions, ownership, and idempotence.

## 4. Documentation and Verification

- [x] 4.1 Document the interactive, machine, and Agent Skill workflows plus the declaration/synchronization boundary; verify examples use the supported request contract.
- [x] 4.2 Run focused package tests, strict `add-skill-authoring` validation, diff hygiene, and the full Workspace check; fix only regressions within this change.
