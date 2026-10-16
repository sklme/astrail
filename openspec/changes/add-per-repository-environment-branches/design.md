# Design

## Context

See proposal.md for motivation. Schema, resolved topology, authoring, and checkout observations currently carry a single required branch. Checkout already deduplicates Git top-level paths, validates a reviewed plan under an operation lock, and verifies the final state.

## Goals / Non-Goals

Goals: extend the current model without breaking existing manifests; keep branch resolution portable and branch mutations explicit.

Non-goals: no changes to repository source revisions, remote operations, implicit member discovery, or root registration.

## Decisions

- Retain the membership array and add `checkout.branches: Record<repositoryId, branch>` with optional `checkout.branch` fallback. Replacing the array with objects would break consumers; a separate map extends it compatibly.
- Share pure selection and mapping validation in core. Schema validates field shapes; resolution validates membership and coverage. Machine authoring uses top-level `branches` alongside its existing `branch` input and performs the same semantic validation.
- Record the effective desired branch on each repository observation and physical checkout. A physical checkout with conflicting member targets yields an error and no action for that checkout. Status aggregates these diagnostics and never reports a conflicted environment as consistent.
- Retain the environment-level desiredBranch only as the optional default; human output explicitly labels it a default and exposes individual targets. Checkout actions already bind target branches into plan IDs, preserving stale-plan detection.
- Keep CLI prompts/formatting outside core. Authoring writes only the reviewed shared manifest; branch overrides retain normal manifest provenance and local layering rules. User branch strings remain untrusted data passed as Git arguments. No shell interpolation or new trust boundary is introduced.

## Risks / Trade-offs

- Shared subdirectory repositories cannot independently select branches → detect conflicts before any mutation.
- Existing JSON clients may have treated desiredBranch as universal → preserve it as a fallback and add per-repository desiredBranch; document this distinction.
- Cross-repository checkout remains non-atomic → retain completed/remaining action reporting and no automatic reset.

## Migration Plan

No migration is required for old manifests. Regenerate schema types/docs, ship the additive minor change, and document that mappings require the new version. To return to older versions, remove mappings and use shared-branch environments.
