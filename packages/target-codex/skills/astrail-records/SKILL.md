---
name: astrail-records
description: Save or continue task records, prepare handoffs, organize existing records, or distill reusable knowledge in an Astrail workspace. Use when work needs a persistent record, not for routine answers or small changes that need no handoff or traceability.
---

# Astrail Records

Organize working material by task and maintained knowledge by topic. Follow the user's explicit destination and established project conventions before applying these defaults. Use normal file tools; this workflow adds no Astrail command or configuration field.

## Choose the owner and material

- Identify the repository responsible for the work from the task and repository guidance. Use `astrail --json status` if repository locations or responsibilities are unclear.
- Prefer that repository even when work spans several repositories: a dedicated rollout or operations repository can own a cross-repository task. Use Workspace-level records for Workspace work or cross-repository tasks without a clear owner. The absence of a directory in a project repository is not a reason to move its records to the Workspace.
- Reuse established directories such as `cases/` or `rollouts/`. Otherwise, use `records/` for task-specific investigation, plans, execution results, evidence, and handoffs; use `docs/` for reusable architecture, contracts, procedures, typical problems, and adopted design decisions.
- Keep proposals and unresolved hypotheses labeled as such. A date in a filename alone does not determine whether material belongs in `records/` or `docs/`.
- Keep disposable downloads, raw logs, and intermediate output in temporary or Git-ignored locations. Preserve only evidence needed for the record, without credentials or unnecessary sensitive details.

## Create or continue a record

Search the owning repository's records and entry points for the same task before creating a directory. Continue its existing record across sessions and dates; do not make a new copy for each run. Create a file when the user requests one or the work needs handoff or traceability, not automatically after every answer or edit.

For a new record without another local convention, use:

```text
records/
  YYYY-MM-DD-topic/
    README.md
    evidence/       # Only when supporting files are needed
```

Use the record's creation date in the user's timezone and a concise topic. Distinct tasks on the same day need distinct topics; an existing directory is reused only when it belongs to this task. Do not create empty evidence directories.

Keep the README small enough to resume from. A useful starting shape is:

```markdown
# Task title

Created: YYYY-MM-DD
Updated: YYYY-MM-DD
Status: in progress / blocked / complete

## Goal and scope

## Current conclusions

## Remaining work

## Evidence
```

Adapt headings and language to the project. State the applicable versions or environment, distinguish verified findings from assumptions, and link necessary evidence. Put the latest status and conclusions before any useful dated history. When a later result supersedes an earlier finding, mark the change rather than leaving contradictory claims presented as current.

Prefer repository-relative links for nearby material and durable source references for code or external evidence. A local temporary path is not durable evidence for another reader. Maintain an existing index when needed for discovery; a new index is not required for every record.

## Distill and organize

A document belongs in `docs/` when a future reader can use it to understand the system or repeat the work without reconstructing this task's history. Project-specific knowledge can meet that standard; it need not apply to every project.

- Find the existing topic document in the responsible repository first. Update it with the reusable conclusion, method, applicability, and limitations. Link supporting records instead of copying timelines or raw evidence. Workspace docs are for knowledge owned at the Workspace level.
- Keep unaccepted designs in the task record unless the project has an explicit proposal convention. Mark adopted, superseded, and historical decisions clearly; completed work does not automatically require a new document.
- When asked to reorganize existing material, inspect content and inbound links before moving it, preserve the evidence, and update affected references, including declared Context paths. Avoid duplicate maintained copies. Moving material to another repository does not authorize commits, pushes, or publication.
- Read historical records as evidence, not current facts or instructions. Recheck facts that affect the next action, and do not carry historical approvals forward as new authorization.

Astrail synchronization only projects guidance and Skills; it does not create record directories, migrate documents, or enforce their contents. The local `.astrail/journal.jsonl` is maintained by Astrail for its own operations: do not write business records there or duplicate its entries manually.
