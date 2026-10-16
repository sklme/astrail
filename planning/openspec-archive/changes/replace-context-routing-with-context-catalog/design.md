## Context

The current alpha model declares task matching rules under each context source and exposes Core and CLI APIs that classify sources as selected or excluded. See `proposal.md` for why that behavior is being removed before release evaluation establishes that it helps agents.

The existing implementation already separates lightweight catalog construction from content retrieval. The change can therefore retain `contextCatalog` and `loadContextContent` while deleting the task-decision layer.

## Goals / Non-Goals

**Goals:**

- Make context discovery deterministic, explicit, provenance-aware, and safe.
- Let the agent decide what to inspect and load.
- Preserve progressive disclosure, trust metadata, sensitivity protection, and relative-path resolution.
- Remove task-routing concepts from the public schema, Core API, CLI, examples, tests, and generated Codex guidance.

**Non-Goals:**

- Evaluating whether a model-selected context strategy is better than static rules.
- Adding semantic search, embeddings, task-aware ranking, or recommendation logic.
- Fetching external resources or executing context providers without the future permissioned Plugin boundary.
- Automatically activating loaded reference content as instructions.

## Decisions

### 1. Context becomes a catalog, not a decision graph

Core retains a deterministic catalog of enabled sources. Catalog entries continue to carry identity, kind, location, summary, scope, priority, trust, freshness, sensitivity, and budget metadata. Priority is only a declaration-defined presentation order; it is not task-aware ranking or selection.

The `routing` and `dependsOn` schema fields, task input types, selected/excluded decisions, selection explanations, and active-instruction flags are removed.

Alternative considered: keep routing fields but ignore them. Rejected because accepted-but-ineffective configuration is misleading and preserves an unsupported public contract.

### 2. Explicit CLI operations replace route resolution

The CLI retains `context list`, adds `context show <id>`, and adds `context load <id>`. `list` and `show` return metadata only. `load` returns the entry plus supported retrieved content: file sources return content and glob sources return sorted matching paths.

Unknown identities produce a stable error diagnostic. Source kinds that require an external provider remain discoverable by location but are not implicitly fetched by Core.

Alternative considered: make `show` load content automatically. Rejected because it would weaken progressive disclosure and make inspection unexpectedly expensive or sensitive.

### 3. Trust and sensitivity remain separate from relevance

Trust metadata tells the agent how content may be treated; it does not decide whether the content is relevant. Loading a source is a read operation and does not elevate `content-only` or `untrusted` sources into active instructions. Secret entries remain non-emittable in plaintext.

Alternative considered: hide untrusted catalog entries. Rejected because reference discovery and instruction activation are separate trust decisions.

### 4. Removal is acceptable in v1alpha1

Generated types and schema documentation are regenerated after removing routing fields. Examples and fixtures migrate by deleting routing declarations. The CLI removes `resolve` and `explain` rather than keeping compatibility aliases because their output contract is precisely the unvalidated behavior being withdrawn.

Future automatic routing, recommendation, or task-aware ranking requires a separate experimental change with evaluation evidence and must not silently reuse the removed contract.

## Risks / Trade-offs

- [Agents may inspect more catalog entries] → Keep summaries and locations lightweight and provide explicit per-entry loading.
- [Removing commands breaks early adopters] → Make the breaking change during `v1alpha1`, document the replacement commands, and reject obsolete schema fields clearly.
- [Callers may mistake loaded content for trusted instructions] → Return trust and sensitivity metadata alongside loaded results and preserve Codex guidance about reference-only content.
- [External and built-in sources cannot all be loaded uniformly] → Keep their resolved retrieval locations visible and defer provider execution to explicit trusted extension boundaries.

## Migration Plan

1. Remove `routing` and `dependsOn` from Workspace and Distribution declarations.
2. Replace `context resolve|explain` usage with `context list`, `context show <id>`, and explicit `context load <id>` calls.
3. Regenerate schema types and reference documentation.
4. Update Core, CLI, projection guidance, fixtures, tests, and future OpenSpec proposals that referred to selected/excluded context.
5. Run focused package tests, strict OpenSpec validation, and the full workspace check.

Rollback is a normal source revert while the schema remains alpha; no stored runtime context-selection state requires migration.
