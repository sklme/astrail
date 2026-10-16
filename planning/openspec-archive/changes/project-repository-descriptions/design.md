## Context

See `proposal.md` for motivation. The public Workspace schema already accepts optional repository
`description` and `role` fields, and machine repository-addition requests already carry them. The
gaps occur after declaration: the terminal prompt omits description, resolved topology drops it,
and Codex managed instructions ignore both description and role. Existing workspaces without
descriptions must remain valid.

## Goals / Non-Goals

**Goals:**

- Preserve one description value through declaration, planning, resolution, inspection, and target
  projection.
- Keep human and Agent authoring on the same previewable core plan/apply contract.
- Make missing descriptions visible without turning advisory project knowledge into enforcement.
- Keep projected instructions concise and deterministic.

**Non-Goals:**

- Add repository-relative Context sources, discovery, import, routing, or eager content loading.
- Generate descriptions with a model inside portable core or introduce company-specific metadata.
- Interpret description text as executable instructions or repository instruction trust.
- Require migrations for existing manifests.

## Decisions

### Reuse the existing optional schema field

Core adds description to the resolved repository type and copies the already validated manifest
value unchanged. No new schema property or storage layer is needed. The field stays optional so old
manifests and Distributions remain compatible.

Alternative considered: make description schema-required. Rejected because it would invalidate
existing portable workspaces and force a migration for an advisory quality improvement.

### Make terminal authoring strict and machine authoring advisory

The terminal wizard requires a non-empty description for newly authored repositories. The shared
core request remains optional because scripts and Agents may be replaying older request documents;
planning such a request returns an informational diagnostic and remediation. Both paths still call
the same core normalization, dry-run, plan-ID, and apply logic.

Alternative considered: synthesize text from repository ID, URL, README, or package metadata.
Rejected because guessed responsibility text would be low quality and could cross an instruction
trust boundary. A conversational Agent may propose text from available evidence, but the proposal
must appear in the reviewed JSON plan.

### Project a compact repository card

The managed Codex region renders one deterministic catalog entry per repository containing ID,
optional role, description or an explicit missing-description marker, and the existing topology
facts. Description is treated as declarative reference metadata, not as an instruction source.

Alternative considered: copy README or Context content into root `AGENTS.md`. Rejected because it
would increase prompt size, blur provenance and trust, and duplicate the future Context workflow.

### Diagnose gaps once at workspace level

Doctor emits one information-level diagnostic with sorted repository IDs rather than one diagnostic
per repository. Information severity remains informational under strict mode. Remediation points to
repository authoring or direct manifest review but does not mutate configuration.

Alternative considered: require description during validation. Rejected because workspace validity
and quality of Agent-facing knowledge are separate concerns.

### Keep Agent interaction declarative and attributable

The projected repository Skill requires `description` in its intent-gathering guidance, permits a
clearly labelled proposal based on user-provided or inspected evidence, and always sends the final
text through `repo add --input ... --dry-run`. The returned plan remains the only object the user
authorizes. Agent guidance cannot edit manifests directly or treat `nextSteps` as authorization.

## Risks / Trade-offs

- [Descriptions become stale] → Keep them concise, show provenance through existing configuration
  inspection, and leave richer volatile knowledge to future Context sources.
- [Legacy repositories produce noisy diagnostics] → Aggregate IDs into one information diagnostic
  and never fail strict doctor for this condition.
- [Agents mistake descriptions for instructions] → Label them as repository responsibility metadata
  and preserve the separate repository instruction-trust contract.
- [Human and machine inputs differ on requiredness] → Keep core semantics explicit: omission is
  compatible but diagnosed; the terminal adapter applies the stronger authoring UX policy.

## Migration Plan

No manifest migration is required. After upgrading, existing workspaces continue to resolve and
receive an informational doctor finding until descriptions are added. Running `astrail sync` updates
the managed Codex region with repository cards; rollback restores the prior renderer while leaving
ordinary description fields untouched.
