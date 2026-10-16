# Design

## Storage and ownership

Use `.astrail/journal.jsonl`, one event per line, default 2,000 lines and 4 MiB. `astrail.local.yaml.journal` configures enabled/maxLines/maxBytes. Strip this local-only field before composition so journal preferences cannot stale a reviewed plan. Schema generation documents the compatibility change for older runtimes.

Use an independent short journal lock and atomic replacement to merge appends and trim the oldest events. A completed event repeats operation metadata so it remains useful if the start has expired. Large detail arrays are truncated with an explicit omitted count. Do not overwrite malformed or unsupported history on subsequent writes; readers skip those lines with warnings. Reject symlink/non-regular destinations and bound reads.

Preserve `.astrail/.gitignore` and append exact local-artifact rules. A newly created ignore file ignores itself. Do not alter a precomputed editor plan's root `.gitignore`. Detect already tracked journals and warn without changing the index. Temporary files and the lock are implementation details, not additional retained history.

## Operation scope and execution facts

The CLI wraps an explicit mutation command set in a portable Core `withWorkspaceJournal` scope. AsyncLocalStorage shares the operation ID, targets and effect collector across Core and target-adapter substeps. Public Core APIs can opt into the same scope. Queries, previews and direct low-level APIs do not acquire history or write logs independently.

Write the start lazily before actual mutation. Record completed atomic file writes using hashes, repository registration, physical checkout changes mapped to logical members, prepared clones, projection effects, and selected lock resolution fields. Rollback writes remain visible; a failed operation with net-restored state is failed rather than partial. Capture failed mutation attempts even before effects occur. Exceptions finish the journal and preserve the original exception/exit semantics. Do not infer completed work from a plan.

Unmatched starts are unknown, not failed. No guarantee is made across process termination or logging failure. Journal failures yield warnings; successful business operations remain successful. Compound bootstrap/import/editor work shares the initiating operation ID. There is no top-level operation lock around the command: existing mutation locks remain responsible for workspace writes; journal appends never hold a journal lock while executing business work.

## Trust and provenance

Store explicit entity IDs, runtime version, plan ID when available, timestamps, observed revisions, file hashes and diagnostic codes. Exclude raw requests, argv, output, arbitrary error text, credentials and resource URLs. Sanitize display strings and known credential forms. History is untrusted local data; it neither grants authorization nor supersedes current observations. Direct user edits and external commands remain outside coverage.

## Agent integration

AGENTS.md provides the discovery entry point. The existing inspection Skill describes bounded/filter-first lookup, partial failures, unknown outcomes, omitted/expired history and current-state verification. No default full-history context injection and no manual duplicate recording.
