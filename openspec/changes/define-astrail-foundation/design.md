## Context

The repository currently contains an initialized OpenSpec planning home and generated OpenSpec integrations for Codex, Claude, and CodeBuddy, but no Astrail implementation, product documentation, package structure, or Git history. The Market multi-repository workspace provides the reference practice: a thin control repository, independent child repositories, centralized branch and environment facts, cross-repository OpenSpec, Skill aggregation, bootstrap, status, and doctor scripts.

That practice proves the value of an agent-oriented workspace, but also exposes design limits that Astrail must address: fixed shell parsing, duplicated branch values in Skills, fixed Skill-link lists, symlink portability, lack of lock state, incomplete worktree support, and rules that are advisory rather than enforceable. See `proposal.md` for product motivation and scope.

## Goals / Non-Goals

**Goals:**

- Establish a portable core model and schema that are independent of company infrastructure and AI vendor.
- Make the first usable experience Codex-first and native: prepare the workspace, then develop by talking directly to Codex from the workspace root.
- Separate declared configuration, local machine state, dependency locks, dynamic observations, task context, and agent projections.
- Give every resolution and recommendation stable provenance and an explanation.
- Preserve existing repositories and user-authored files through non-destructive, previewable lifecycle operations.
- Allow organizations to package configuration and resources without requiring forks of the engine.
- Leave clean extension seams for MCP, executable Plugins, additional agent targets, registries, and UI.

**Non-Goals:**

- Enforcing filesystem or Git permissions, intercepting direct commands, or acting as a mandatory development gateway.
- Providing cross-repository atomic commits or replacing Git, CI, deployment, OpenSpec, or AI coding agents.
- Shipping company-specific Git, authentication, log, monitoring, or environment providers in the core.
- Implementing a general executable Plugin sandbox, central registry, graphical UI, or non-Codex target in the first release.
- Eagerly copying all child-repository documentation and Skills into the control repository.

## Decisions

### 1. Astrail is a resolver and control plane, not a repository container

The core abstraction is a resolved task-capable workspace, not a nested Git layout. A workspace may materialize managed Git sources under `repos/`, link existing local roots, derive logical roots from monorepo subpaths, or combine these approaches. Astrail records and explains the topology but does not absorb child histories.

Alternative considered: require all child repositories beneath a meta-repository. Rejected because it prevents adoption in existing layouts and confuses local placement with workspace identity.

### 2. Use one declaration model and four resolved graphs

The core resolver produces four related views:

```text
astrail.yaml + Distributions + local state + lock constraints
                              │
                              ▼
                    Astrail Core Resolver
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   Topology graph       Context graph       Capability graph
   repos/environments   sources/routes      skills/tools/plugins
          └───────────────────┼───────────────────┘
                              ▼
                       Operation graph
                bootstrap/status/sync/update/etc.
```

The graphs are views of one resolved model rather than separately edited databases. This keeps repository, context, capability, and operation references type-checkable.

Alternative considered: separate configuration files for repositories, environments, Skills, and operations. Rejected for the initial version because cross-references and composition would be harder to validate. Large workspaces may split files later through schema-defined imports.

### 3. Use a versioned YAML family validated by JSON Schema

The configuration family is:

```text
astrail.yaml        shared declared state
astrail.local.yaml  machine-local paths and non-secret overrides; ignored
astrail.lock.yaml   generated dependency and integrity resolution
```

YAML is selected for authoring ergonomics. JSON Schema Draft 2020-12 is the canonical structural contract and enables editor completion, validation, documentation generation, and conformance fixtures. Schema versions are explicit and migrations are never silent.

Resolution order is:

```text
core defaults
  → ordered Distribution defaults
  → shared workspace declarations
  → machine-local overrides
  → lock constraints
  → read-only runtime observations
```

The resolver records source provenance at every merged field. Runtime observations such as current Git branch and dirty state never become declared or lock state automatically.

Composition uses typed merge rules rather than YAML merge keys or positional array merging. Scalars are replaced by the later layer, ordinary maps merge by key, and repository, environment, context, capability, operation, target, and Distribution collections merge by stable identity. Ordered scalar lists replace as a whole unless their schema explicitly defines another strategy. Upstream entries are disabled only through an explicit `disabled: true` declaration. Every replacement, disablement, and unresolved conflict is retained in a sidecar provenance index keyed by stable entity path. YAML `<<` merge keys are not Astrail composition semantics.

Relative local-source paths resolve against the Workspace root, subpaths resolve against their declared parent repository, Distribution resources use the Distribution root, and repository-owned resources use the resolved repository root. They never depend on the shell's incidental working directory after workspace discovery.

Astrail distinguishes the effective configuration (the deterministic result of declared-layer composition) from resolved graphs and runtime observations. `astrail config show` emits the effective configuration as YAML or JSON, `astrail config layers` lists contributing layers, and `astrail config explain <path>` reports the complete provenance chain for a field. These commands redact resolved secrets and do not mix current Git observations into configuration output.

Alternative considered: make the lock file the fully resolved workspace. Rejected because dynamic state and machine paths would make locks noisy, sensitive, and non-portable.

### 4. Repository sources and policies are explicit

Every repository declares one source: managed Git, linked local, or a subpath derived from another repository. Git placement is deterministic at `repos/<id>`; local paths remain user-owned; subpaths never trigger a second clone. Requiredness, `read-only` or `read-write` access, role, and instruction trust remain independent policies. A subpath may narrow but never widen its parent's access. Repository content is available once declared, while instruction trust controls whether repository-owned `AGENTS.md` files and Skills may become active. Executable Plugins use their own explicit review and permission lifecycle.

Read-only is advisory. Astrail reports observed mutations and projects the policy to Codex, but does not claim operating-system enforcement.

### 5. Context is routed, not concatenated

Every context source has metadata sufficient for discovery and task routing. Full content is loaded progressively. The context resolver returns:

- ordered selected sources;
- excluded sources relevant enough to explain;
- provenance and resolved locations;
- selection rules and dependencies;
- trust and sensitivity decisions;
- freshness and optional budget information.

Stable policy belongs in a concise root `AGENTS.md`. Dynamic facts remain in Astrail state. Detailed domain knowledge remains in context packs or repository-owned documents. Context-source content trust does not activate repository instructions; those require explicit repository or capability instruction trust.

Alternative considered: generate one comprehensive AGENTS file. Rejected because large eager context becomes stale, consumes model context, and obscures provenance.

### 6. Capability package identity is not the invocation name

A capability may have a registry identity such as `example/loghelper@2.1.0`, but its Codex-visible alias can be `loghelper`. Users invoke the short alias explicitly or trigger the Skill naturally through its description; they do not need to know the namespace or directory.

The resolver supports required, peer, recommended, optional, and conflicting dependencies. Recommendations are declarative and never auto-installed. Duplicate exposure aliases are errors until explicitly selected or renamed.

Agent-facing Skill directories are generated projections or links. The original package or child repository remains authoritative, and lock state records identity, version, source, and integrity.

Alternative considered: use namespaced directories as user-facing Skill names. Rejected because Agent Skill naming constraints and normal conversation favor short stable names, while namespaces remain necessary for package resolution.

### 7. Distribution is declarative composition; Plugin is executable extension

A Workspace Distribution is a versioned declarative package that contributes defaults, context packs, capability dependencies, policies, and Plugin requirements. A company or community can publish a Distribution without changing the Astrail engine.

A Plugin is reserved for executable contributions such as repository providers, environment providers, context providers, operations, validators, target renderers, or future UI panels. Core extension data is namespaced. Executable Plugins remain inactive until their source and permissions are trusted.

The initial implementation supports local or Git-resolved declarative Distributions. A general Plugin SDK and registry protocol are later roadmap items.

Alternative considered: call every reusable package a Plugin. Rejected because it would require execution trust for harmless configuration and turn Plugin into an ambiguous catch-all.

### 8. Codex support is a target renderer, not a chat proxy

The first target implementation translates resolved Astrail state into Codex-discoverable artifacts. It is invoked during init, bootstrap, and sync, then leaves normal development to Codex.

Initial Codex projection responsibilities are:

- manage a marked Astrail region in root `AGENTS.md` while preserving user content;
- expose selected Skills under unique short aliases in a Codex-supported project location;
- expose dynamic-state lookup instructions through the `astrail` CLI;
- render supported MCP or tool configuration when declared;
- maintain a generated projection manifest for drift diagnosis.

The implementation should be named as a Codex target or renderer initially. A generalized Adapter SDK is extracted only when the second agent target provides evidence for the common interface.

Alternative considered: run Astrail as a mandatory proxy around every Codex task. Rejected because it degrades the native development experience and makes Astrail a runtime bottleneck.

### 9. The CLI is the first client of a reusable TypeScript core

The initial implementation uses Node.js 22.12 or newer, native ESM, strict TypeScript, and a pnpm-managed monorepo. Node.js 24 LTS is the recommended development runtime, with CI covering the minimum and recommended LTS lines. Proposed packages are:

```text
packages/schema        versioned schemas and generated types
packages/core          loading, composition, resolution, diagnostics
packages/cli           astrail command surface and human/JSON output
packages/target-codex  Codex projection and doctor checks
packages/testing       fixtures and conformance helpers
```

The root package is private. Public alpha packages share one release version: `astrail-schema`, `astrail-core`, `astrail-target-codex`, and the `astrail` CLI package; `astrail-testing` remains private until its API is proven. Package dependencies are one-way: schema → core → target-codex, while CLI composes core and targets. Source-code imports across package boundaries are forbidden.

Commander.js parses CLI arguments and renders help but is not part of the core architecture. Command factories create local `Command` instances, use asynchronous parsing and overridable output/exit behavior, and delegate to typed application functions. Core code never imports Commander, writes to the console, or terminates the process. JSON Schema Draft 2020-12 remains the canonical type contract, Ajv performs structural validation, and the `yaml` document API supplies source locations. The first release uses TypeScript project builds without a bundler, Vitest for unit and process-level CLI tests, and Biome plus TypeScript for formatting, linting, and type checks.

The published executable is `astrail`. The CLI must keep business logic in `core` so a later MCP server and UI consume the same resolution behavior. Astrail's own source repository being a pnpm monorepo does not impose a monorepo layout on workspaces managed by Astrail.

Alternative considered: Rust or Go single-binary implementation. Deferred because TypeScript shortens initial schema, YAML, Skill, package, and plugin ecosystem work. A future standalone distribution can bundle the Node application if installation friction becomes material.

### 10. Commands are machine-readable, previewable, and non-destructive

The initial command families are:

```text
astrail init
astrail validate
astrail status [--json]
astrail doctor [--json] [--strict]
astrail repo list|resolve|show
astrail env list|resolve|show
astrail context list|resolve|explain
astrail capability list|resolve
astrail config show [--format yaml|json] [--provenance]
astrail config layers
astrail config explain <path>
astrail render|sync
astrail bootstrap [--dry-run]
astrail update [--dry-run]
astrail lock
```

Human output and stable JSON output are views of the same typed result. Mutating commands plan changes before applying them. Existing repositories, uncommitted files, user-owned instruction sections, and untrusted executable content are never overwritten implicitly.

Structured output uses a versioned envelope containing command, success, data, diagnostics, and metadata. JSON data is written only to stdout; diagnostics and debug output use stderr; JSON and non-interactive modes never display color, progress animation, or prompts. Exit codes distinguish success, validation failure, usage error, runtime I/O failure, refused unsafe mutation, and interruption without encoding individual diagnostic kinds into exit status.

### 11. File ownership is explicit

Every artifact written by Astrail is one of:

- fully user-owned: Astrail only reads it;
- managed region: Astrail updates bounded markers and preserves other content;
- fully generated: Astrail owns the file and records it in the projection manifest;
- derived link: Astrail owns the link but not its target.

Sync refuses ambiguous ownership and reports a repair action. This avoids the Market workspace problem where fixed scripts and tracked links can silently diverge from the intended capability catalog.

### 12. Security is based on provenance, trust, and side-effect classification

Read-only data can still carry hostile instructions, and a recommended Skill can still execute code. Therefore Astrail independently records:

- source provenance and integrity;
- content trust;
- executable trust;
- requested Plugin permissions;
- operation side-effect class;
- sensitivity and secret-reference boundaries.

The advisory core warns and explains. It does not bypass the host agent's approvals or security model. Secrets are resolved only at the point of use and are never persisted to shared, lock, generated instruction, or diagnostic output.

The alpha manifest cannot contain an arbitrary shell command. Generated context in `0.1` is limited to named, built-in, read-only providers whose arguments are schema validated. External executable providers arrive only through the future trusted Plugin model. Process execution uses executable-and-argument arrays without a shell and redacts sensitive arguments from diagnostics.

## Roadmap

### Phase 0 — Foundation contract

- Establish Astrail naming, slogan, product boundaries, glossary, schemas, and conformance scenarios.
- Capture the Market workspace as a reference case without importing company-specific values.
- Decide repository licensing and package publication names before the first public release.

### Phase 1 — `0.1` Codex-first foundation

- Create the TypeScript package workspace and versioned JSON Schema.
- Load and compose shared, local, and Distribution declarations.
- Resolve repository, environment, context, and capability graphs with provenance.
- Implement `validate`, `status`, `doctor`, repository/environment inspection, context explanation, and capability listing with human and JSON output.
- Implement the Codex target for managed instructions and Skill projections.
- Provide `astrail init`, example workspaces, schema fixtures, and a Market-derived compatibility fixture.
- Implement non-destructive repository bootstrap and local-path onboarding.
- Generate and consume `astrail.lock.yaml` for Distribution and capability versions and integrity.
- Implement idempotent sync, dry-run update, rollback to prior lock state, and generated-artifact drift repair.
- Support local and Git-based Workspace Distributions with deterministic composition.

Success criterion: another developer can reproduce an Astrail workspace from its definition and lock state, inspect the fully resolved workspace, render Codex context and Skills, open the root in Codex, and work normally without overwriting existing work.

### Phase 2 — `0.2` permissioned extensions and MCP

- Define a permissioned executable Plugin manifest and provider lifecycle.
- Add MCP Resources for context, read-only MCP Tools, and optional prompt or meta-Skill contributions.

Success criterion: company-specific infrastructure can extend Astrail without a core fork, while executable code stays inactive until reviewed.

### Phase 3 — `0.3` portability and ecosystem discovery

- Add signed or integrity-checked package acquisition and a registry abstraction.
- Add a second agent target and extract the proven common target interface.
- Add advisory organization policy packs and compatibility reporting.

Success criterion: a second agent consumes the same portable model and reusable artifacts can be discovered and verified without automatic installation.

### Phase 4 — `0.4+` ecosystem and visual control plane

- Add a UI backed by the same core library for topology, context explanations, diagnostics, dependency review, and update previews.
- Add organization policy packs, registry discovery, signatures, compatibility reporting, and optional privacy-preserving telemetry.
- Evaluate remote and hosted workspace resolution without changing local-first semantics.

Success criterion: teams can discover, govern, and visualize reusable Workspace Distributions and extensions while CLI and agent results remain identical.

## Risks / Trade-offs

- [The initial schema becomes too broad before implementation feedback] → Keep the first schema version alpha, ship fixtures early, and require explicit migrations rather than compatibility promises before `v1`.
- [Astrail duplicates package-manager behavior] → Limit the resolver to Astrail artifacts and reuse Git or existing package transports instead of inventing a general registry protocol in `0.1`.
- [Generated AGENTS content conflicts with user instructions] → Use explicit managed regions, preserve all external content, and make precedence visible in doctor output.
- [Recommendations become noisy or promotional] → Require declared provenance, never auto-install recommendations, and allow projects or users to suppress them.
- [Read-only is mistaken for enforcement] → Label it advisory in schema documentation, diagnostics, and projections; reserve errors for invalid configuration unless strict policy is explicitly enabled.
- [Plugin execution creates a supply-chain boundary] → Keep `0.1` declarative, require explicit trust and permissions later, and lock identity and integrity before activation.
- [Codex-specific choices leak into the core] → Isolate target settings under namespaced extensions and generated artifacts; add a second target only after the portable model is proven.
- [Symlinks are not portable] → Treat link, copy, and manifest-based projection as target strategies and diagnose platform support rather than making symlinks the core model.
- [Workspace definitions expose secrets or internal topology] → Use secret references, sensitivity metadata, sanitized diagnostics, and publishable/local overlays.

## Migration Plan

1. Use the current Market workspace as a read-only fixture and map its repositories, environments, context, Skills, and scripts into the alpha Astrail model.
2. Compare Astrail `status` and `doctor` output with the existing scripts until the new resolver covers the proven behavior.
3. Render Codex artifacts into an isolated fixture and verify Skill discovery and AGENTS ownership without changing the live Market workspace.
4. Add an import or guided migration command only after the mapping is stable; generate a preview and never delete the original scripts or configuration.
5. Allow the existing workspace and Astrail to run side by side during adoption. Rollback consists of removing Astrail-generated projections and returning to the existing control scripts.

## Decisions closed during implementation

- Astrail uses Apache-2.0, the `astrail*` package namespace, and `astrail` for the CLI package.
- The alpha Codex target uses project-local `.agents/skills/<alias>` with link, copy, and manifest-only strategies.
- Local and Git artifacts use deterministic SHA-256 content integrity in lock and projection state; future registries may add transport-specific signed metadata without replacing the core integrity field.
