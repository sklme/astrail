## Context

See `proposal.md` for motivation. Astrail already resolves repository-backed Capability paths and provides a single-Skill request/plan/apply authoring service. The CLI and built-in `astrail-skills` Agent Skill are thin adapters over that service. Repository roots can be managed Git, linked local directories, or subpaths derived from another repository; discovery must consume the resolved roots without changing repository lifecycle.

The new workflow crosses core, CLI, and one target-owned Skill, and it reads instruction-bearing files. It therefore needs deterministic traversal, explicit trust visibility, source provenance, and stale-plan protection while retaining Capability as the sole persistent model.

## Goals / Non-Goals

**Goals:**

- Discover existing Skills from declared, locally available repository roots without changing state.
- Let one reviewed plan add any explicit subset atomically.
- Share normalization and mutation semantics with existing Skill authoring.
- Give interactive CLI and agent conversation equivalent capabilities through one JSON contract.
- Make source ownership, trust, conflicts, and already-declared state visible before selection.

**Non-Goals:**

- Recursive arbitrary `SKILL.md` search, network discovery, filesystem watching, or a durable discovery index.
- Automatic import, instruction trust, acquisition, or projection.
- Treating a repository as a Skill package or adding repository-level Skill export configuration.
- Changing how Codex discovers the Workspace's projected `.agents/skills` directory.

## Decisions

### Scan a small convention set at one directory level

Core scans immediate child directories beneath `.agents/skills`, `.codex/skills`, and `skills` in each selected repository root. A candidate must contain `SKILL.md`, remain lexically and physically beneath its resolved repository root, and provide a valid frontmatter `name`. Traversal does not recursively search arbitrary source trees and does not follow an escaping symlink.

Supporting the three established layouts lets existing repositories participate without new configuration. A repository-level `exports.skills` list would create a second persistent declaration surface, while unrestricted recursive search would be noisy, slow, and more likely to read unrelated instructions.

### Model discovery as an ephemeral projection over resolved repositories

Core returns candidates rather than adding a new Workspace field. A candidate key combines repository ID and normalized relative path; ordering is repository ID then path. It includes parsed name and description, default identity `${repositoryId}/${name}`, sanitized Capability ID and alias, repository instruction-trust state, SHA-256 fingerprint of `SKILL.md`, current declaration match, and conflict diagnostics.

Discovery accepts an explicit repository ID list or `all`. Unknown selected repositories are errors; unavailable declared repositories produce diagnostics and no network operation. Subpath repositories are scanned at their own resolved logical roots. The same physical Skill reachable through multiple declared logical repositories remains distinct provenance because import must name one owning repository.

### Send explicit selections, not opaque discovery sessions

Machine import accepts `selections`, each containing repository ID, relative path, and optional reviewed identity, ID, alias, version, and instruction trust. Core re-discovers and fingerprints each selection during planning, so callers do not need a server-side session and cannot turn an arbitrary repository path into an import by skipping discovery validation.

Defaults come from current candidate metadata, but every normalized field appears in preview. Conflicts are errors unless resolved through explicit overrides. Interactive CLI can therefore pass the numbered subset directly, while an Agent Skill can edit aliases or identities after discussing conflicts.

### Add a batch authoring service while reusing single-addition rules

The new core service normalizes every selection into the existing Skill addition shape and applies cross-selection duplicate checks before producing one plan. Shared helper extraction from `skill-authoring.ts` is allowed only where needed to keep safe-path, ID, source, trust, YAML, hash, and verification behavior identical.

The plan records every addition, selected source fingerprint, exact target file before/after digests, action, and deterministic plan ID. Apply holds the Workspace lock, rechecks the manifest and fingerprints, writes the complete YAML change atomically, reloads the composed Workspace, verifies every resolved Capability, and restores the original file if any verification fails.

One atomic batch is preferable to invoking `skill add` repeatedly: it prevents partial selection imports and gives users and agents one review boundary. The output remains ordinary `capabilities` entries, so existing resolution and synchronization require no schema change.

### Keep CLI interaction separate from portable core behavior

`astrail skill discover --all` and repeatable `--repository <id>` select scope. Human output uses a compact numbered table; JSON output returns candidates and diagnostics. `astrail skill import` discovers the requested scope in interactive mode, filters to importable candidates, accepts a comma-separated numbered subset, collects trust or conflict overrides as needed, previews, and confirms.

Machine import uses `--input <file|-> --dry-run`, then `--yes --plan-id <id>` for apply, matching current authoring safety. JSON and machine modes never prompt. Import never invokes `sync`; the CLI may print the existing separately reviewed follow-up.

### Extend the existing Skill-management Agent Skill

The Codex target does not gain another built-in Skill. `astrail-skills` adds discovery routing, candidate presentation, explicit selection, import preview/apply, and the existing second synchronization authorization. Instructions require the Agent to use CLI JSON output as source of truth and forbid direct YAML edits or inferred trust.

This keeps one conversational entry point for adding direct Git Skills and reusing repository-owned Skills while the portable core remains agent-vendor neutral.

### Surface ephemeral inventory at adjacent workflow boundaries

After an available repository is added, the CLI scans only that repository and returns a compact `repositorySkills` inventory plus structured next steps. Human terminal users may opt into `repo add --import-skills`, which continues into the existing selective import prompter and a distinct import confirmation. Machine and JSON repository input reject that convenience flag: Agents consume candidates, create an explicit selection request, review its import plan ID, and preserve the separate synchronization boundary.

Bootstrap and doctor scan all currently available declared repositories and report unimported candidates additively. The finding is informational rather than a health failure because not every repository Skill belongs in every Workspace. Unavailable Git repositories remain explicit in inventory and can be rescanned after bootstrap; no workflow treats a zero count from an unavailable repository as proof that it owns no Skills.

## Risks / Trade-offs

- [Convention scanning misses nonstandard layouts] → Report the supported roots clearly; users can still use `skill add` with an explicit path, and later conventions can be added compatibly.
- [The same Skill is reachable through symlinked convention roots] → Canonicalize physical paths within each repository and deduplicate candidates while preserving the highest-precedence lexical path.
- [Frontmatter changes between discovery and import] → Re-discover during planning and fingerprint selected `SKILL.md` files in the plan; refuse stale apply.
- [Large workspaces make all-repository discovery slower] → Limit traversal to three shallow directories and scan repositories concurrently with deterministic output sorting.
- [Default identities collide across repositories or names] → Include repository ID in the identity and report, rather than silently rewrite, ID and alias conflicts.
- [Repository-level trust could be mistaken for import authorization] → Display trust as candidate metadata only; import and synchronization remain explicit operations.
- [Convenient post-add discovery could be mistaken for automatic activation] → Return stable counts, candidate metadata, and next steps, but require a second selection/plan confirmation and separate projection preview.

## Migration Plan

1. Add discovery and batch import types and services to core with no schema changes.
2. Add CLI discovery, interactive selection, and machine import adapters.
3. Update the built-in `astrail-skills` instructions and public documentation.
4. Run focused, package, CLI process, strict OpenSpec, and full Workspace verification.

The change is additive. Rolling it back removes discovery/import commands and agent guidance; already imported entries remain valid ordinary Skill Capabilities and require no migration.
