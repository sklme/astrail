## Context

See `proposal.md` for motivation. Repository resolution already lives in `astrail-core`, while `astrail` currently owns command interaction and some direct manifest writing. Codex projection consumes resolved Skills but does not yet ship an Astrail repository-management meta Skill. The current local overlay schema can override `repositories.<id>.source.path`; it cannot hold a complete standalone repository declaration, so machine-local sources require coordinated shared and local edits.

All authoring mutations must remain attributable, previewable, non-destructive, and independent of Git hosts or agent vendors.

## Goals / Non-Goals

**Goals:**

- Give every adapter one typed, non-interactive repository-addition use case.
- Preserve YAML comments and unrelated user-owned content through targeted edits.
- Make a preview safely reusable across an interactive confirmation or a second machine invocation.
- Project a Codex Skill that delegates to the same machine contract used by the CLI.

**Non-Goals:**

- Updating or removing existing repository declarations.
- Cloning a Git repository as an implicit part of authoring.
- Enforcing advisory read access at the filesystem level.
- Adding company Git authentication or provider-specific defaults.
- Generalizing the new Skill into an agent-independent protocol; future targets can adapt the core API independently.

## Decisions

### Add a repository-authoring application service to core

`astrail-core` will expose typed request, plan, and apply operations. The request contains repository intent and a manifest target; the plan contains the normalized declaration, selected target files, before/after digests, targeted YAML output, diagnostics, and a deterministic plan identifier.

Adapters own questions and presentation only. They do not validate topology independently. This keeps Commander.js, terminal state, and Codex instructions outside core. The rejected alternative is separate CLI and Skill implementations, because their defaults and validation would drift.

### Reuse a plan identifier across interaction boundaries

Each plan identifier hashes the normalized request and exact before/after file states. Applying an in-memory plan checks every before digest under the workspace operation lock. A second non-interactive invocation supplies the displayed plan identifier; the CLI replans against current state and applies only if the identifier still matches.

This avoids persisted server-side sessions while detecting changes between preview and apply. Replanning without an expected identifier is rejected for machine input, since it could authorize a plan the caller never reviewed.

### Edit YAML documents at repository paths

Core will parse the existing YAML document and set only `repositories.<id>`, retaining comments and unrelated mappings. A missing local overlay is created with the standard `WorkspaceLocal` headers. Writes use existing atomic replacement and operation-lock primitives. Before any write, all target digests are checked; if post-write composed validation fails, the original file contents are restored.

Whole-manifest serialization was rejected because it would reorder or normalize user-owned content and make the change hard to review.

### Split machine-local repository declarations across layers

`shared` writes the complete declaration to `astrail.yaml`. `local` is valid only for a local source and writes a portable `{ source: { type: local }, ...policy }` declaration to the shared manifest plus the path override to `astrail.local.yaml`. `auto` selects that split for absolute paths and selects `shared` otherwise. Git and subpath repositories remain shared because their identity and location are portable workspace topology.

This fits the existing overlay schema and keeps absolute paths out of versioned configuration. Allowing full repository entries only in the local overlay was rejected because the composed workspace and current schema require the shared declaration to carry repository policy.

### Provide one CLI command with human and machine modes

`astrail repo add` launches a terminal wizard when no input file is supplied. `--input <file|-> --dry-run --json` is non-interactive and returns the core plan. Applying machine input requires `--yes --plan-id <displayed-id>`. JSON mode never opens a prompt. The interactive flow previews the same core plan and asks for confirmation before applying it in memory.

Using scripted terminal prompts as the agent interface was rejected because it is fragile and cannot provide a stable structured contract.

### Ship repository management as a Codex target meta Skill

The Codex target package will contain an `astrail-repositories` Skill and include it in projection ownership like other derived Skills. Its instructions gather intent, invoke the JSON dry-run command, present the returned plan, and use the returned plan identifier only after explicit confirmation. It never edits YAML directly. Other agent targets can later provide equivalent adapters without changing core.

The Skill is a conversation adapter, not executable business logic. A future MCP tool can call the same core APIs directly and replace CLI process invocation without changing user-visible semantics.

## Risks / Trade-offs

- [Targeted YAML mutation can still normalize the edited node's style] → Limit edits to one repository mapping, preserve the document and all unrelated nodes, and test comments and extension fields.
- [A coordinated shared/local update is not a filesystem transaction] → Check all digests before writing, serialize under the operation lock, and restore original contents if writing or verification fails.
- [Interactive prompts can hang in non-terminal environments] → Detect non-interactive input, never prompt in JSON mode, and return a diagnostic that points to `--input`.
- [Always projecting a meta Skill adds a target-owned artifact] → Record it in the projection manifest and respect the existing link/copy/manifest ownership strategy.
- [Core validation and resolver diagnostics could be duplicated accidentally] → Build the proposed composed state through the same schema and repository topology validation path and assert adapter-plan parity in tests.

## Migration Plan

This is additive. Existing manifests and commands continue to work. After release, `astrail sync` projects the new managed Skill; rollback removes the target-owned projection artifact through the existing projection manifest reconciliation. Repository additions made by the new command remain ordinary manifest declarations and require no migration.
