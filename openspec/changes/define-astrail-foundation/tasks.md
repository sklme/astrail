## 1. Product and Repository Foundation

- [x] 1.1 Decide and document the Astrail open-source license, package namespace, repository URL, and supported Node.js range.
- [x] 1.2 Initialize the Git repository and add baseline ignore, editor, contribution, security, and conventional-commit guidance.
- [x] 1.3 Create the root README with the Astrail name, bilingual slogan, advisory-control-plane positioning, quick mental model, and Roadmap summary.
- [x] 1.4 Add Astrail project context and artifact rules to `openspec/config.yaml` without copying change-specific requirements into global context.
- [x] 1.5 Document the glossary for Workspace, instance, Distribution, context pack, capability, Skill, Plugin, operation, target, projection, declared state, resolved state, and lock state.

## 2. TypeScript Package Workspace

- [x] 2.1 Create the pnpm-managed Node.js ESM TypeScript monorepo for `schema`, `core`, `cli`, `target-codex`, and private `testing`, with one-way workspace dependencies.
- [x] 2.2 Configure Node.js 22.12+ support, strict TypeScript, Biome formatting/linting, Vitest, project builds, and package-boundary checks.
- [x] 2.3 Establish shared diagnostic, result, provenance, source-location, and structured-output types in the core package.
- [x] 2.4 Add CI coverage for type checking, linting, unit tests, package builds, and OpenSpec strict validation.

## 3. Versioned Workspace Schema

- [x] 3.1 Define the alpha `astrail.yaml` JSON Schema with explicit API version, kind, metadata, repositories, environments, contexts, capabilities, operations, policies, targets, Distributions, and extensions.
- [x] 3.2 Define explicit managed Git, linked local, and derived subpath repository sources with requiredness, read-only/read-write access, role, Git revision, and instruction trust; keep executable trust in the separate Plugin lifecycle.
- [x] 3.3 Define environment resources independently from branch roles, including provider configuration and secret-reference fields.
- [x] 3.4 Define `astrail.local.yaml` overlay constraints and reject resolved secret values in protected configuration locations.
- [x] 3.5 Define `astrail.lock.yaml` identity, version, source, integrity, and prior-resolution metadata without including dynamic Git state or credentials.
- [x] 3.6 Generate TypeScript types and schema documentation from the versioned schema and add supported/unsupported version fixtures.
- [x] 3.7 Add namespaced extension preservation and target-specific extension validation fixtures.

## 4. Manifest Loading and Core Resolution

- [x] 4.1 Implement workspace-root discovery and YAML loading with precise source locations and sanitized parse errors.
- [x] 4.2 Implement typed deterministic composition of core defaults, Distribution defaults, shared declarations, local overrides, and lock constraints without positional arrays or YAML merge semantics.
- [x] 4.3 Track field-level provenance and implement effective-config show, layer listing, and field explanation for every overridden or selected value.
- [x] 4.4 Build typed topology, context, capability, and operation graph views from one resolved model.
- [x] 4.5 Implement deterministic ordering and conflict diagnostics across composed graph entries.
- [x] 4.6 Implement repository inspection for ordinary clones and Git worktrees without assuming `.git` is a directory.
- [x] 4.7 Implement environment resolution that never infers environment identity solely from a branch name.
- [x] 4.8 Add error, warning, and information diagnostics and keep advisory policy violations non-blocking by default.

## 5. Context Routing

- [x] 5.1 Implement context-source declarations for file, glob, built-in read-only generated providers, external resource, and context-pack references; reject arbitrary shell commands.
- [x] 5.2 Implement routing against task text, selected repositories, paths, environments, operation type, scope, and declared activation conditions.
- [x] 5.3 Implement progressive-disclosure output that returns metadata and retrieval locations before full content.
- [x] 5.4 Prevent `content-only` and `untrusted` sources from activating instructions, Skills, or operations without explicit elevation.
- [x] 5.5 Implement stable priority and tie-breaking behavior with selected and excluded source explanations.
- [x] 5.6 Enforce sensitivity boundaries so generated artifacts, lock state, and diagnostics do not copy protected context or credentials.
- [x] 5.7 Add unit and conformance tests for frontend-only, cross-repository contract, external read-only, freshness, and sensitive-context scenarios.

## 6. Capability Resolution

- [x] 6.1 Implement capability identities, semantic version constraints, sources, integrity metadata, short `exposeAs` aliases, and provenance.
- [x] 6.2 Implement built-in, workspace, trusted child-repository, global, Distribution, and registry source interfaces without requiring a registry in `0.1`.
- [x] 6.3 Implement required, peer, recommended, optional, and conflicting dependency behavior.
- [x] 6.4 Reject ambiguous exposed aliases and provide actionable selection or renaming diagnostics.
- [x] 6.5 Implement deterministic recommendation output with source, compatibility, installation, and suppression state; never auto-install recommendations.
- [x] 6.6 Record resolved capability versions and integrity in lock state and report drift before projection.
- [x] 6.7 Add fixtures proving that `example/loghelper` can be exposed as `loghelper` and invoked without namespace or source-path knowledge.

## 7. Read-Only CLI and Lifecycle

- [x] 7.1 Implement the Commander.js-based `astrail` executable, workspace discovery, help output, versioned JSON envelope, stable stdout/stderr and exit-code contracts, and version reporting.
- [x] 7.2 Implement `astrail init` for creating or adopting a minimal Codex-targeted workspace without importing business repositories into the control repository.
- [x] 7.3 Implement `astrail validate` with schema, composition, reference, dependency, trust, and secret diagnostics.
- [x] 7.4 Implement `astrail status` with repository, environment, context, capability, target-projection, and diagnostic summaries.
- [x] 7.5 Implement `astrail doctor` and optional `--strict` policy escalation while keeping default policy advisory.
- [x] 7.6 Implement repository and environment list, resolve, and show commands with matching human and structured output.
- [x] 7.7 Implement context list, resolve, and explain commands with provenance and selection reasons.
- [x] 7.8 Implement capability list and resolve commands with dependency, recommendation, alias, source, and lock information.
- [x] 7.9 Implement `config show`, `config layers`, and `config explain`, then add snapshot and schema tests ensuring human and JSON output are generated from the same typed results.

## 8. Codex Target

- [x] 8.1 Run a compatibility spike to select and document the alpha Codex project Skill projection strategy.
- [x] 8.2 Implement a projection ownership manifest covering user-owned files, managed regions, fully generated files, and derived links.
- [x] 8.3 Implement marked Astrail-managed regions in root `AGENTS.md` and preserve all content outside the markers byte-for-byte.
- [x] 8.4 Render stable workspace guidance and dynamic Astrail lookup commands without embedding branch, environment, or machine-specific values.
- [x] 8.5 Project resolved Skills under unique short aliases while preserving their canonical identity, source, and version.
- [x] 8.6 Implement Codex projection doctor checks for missing, stale, broken, ambiguous, or user-modified artifacts.
- [x] 8.7 Verify end-to-end that a developer can open the workspace root in Codex and trigger an exposed Skill naturally without an Astrail chat proxy or `astrail run` wrapper.

## 9. Workspace Distributions

- [x] 9.1 Define the versioned Workspace Distribution manifest and declarative contribution boundaries.
- [x] 9.2 Implement deterministic Distribution ordering, project overrides, provenance, and incompatible dependency diagnostics.
- [x] 9.3 Support local-directory and Git-based Distribution sources with version and integrity recording.
- [x] 9.4 Keep context-and-Skill-only bundles executable-permission free and represent executable extension requirements as separate Plugin descriptors.
- [x] 9.5 Add trust diagnostics that leave newly introduced executable Plugins inactive until accepted, without implementing general Plugin execution.
- [x] 9.6 Create a generic backend Distribution fixture that recommends logging diagnostics without containing company-specific hosts, credentials, or repository names.

## 10. Reproducible Bootstrap, Sync, and Update

- [x] 10.1 Implement a change planner shared by bootstrap, sync, update, and lock operations with human and JSON dry-run output.
- [x] 10.2 Implement non-destructive bootstrap for missing required repositories, existing repository validation, local-path onboarding, and optional repository skipping.
- [x] 10.3 Require explicit authorization before cloning repositories or activating newly introduced executable extensions.
- [x] 10.4 Implement idempotent projection sync that updates only Astrail-owned artifacts and refuses ambiguous ownership.
- [x] 10.5 Implement lock generation and reproducible resolution for supported Distribution and capability transports.
- [x] 10.6 Implement update preview, compatible dependency selection, projection-change review, and prior-lock restoration.
- [x] 10.7 Add repeat-run and failure-recovery tests proving that existing repositories, worktrees, local modifications, and user-authored instructions are preserved.

## 11. Reference Workspaces and Migration

- [x] 11.1 Create a minimal public example with managed Git, linked local, monorepo subpath, required/optional, and read-only/read-write repository combinations.
- [x] 11.2 Create a sanitized Market-derived fixture covering branch roles, independent environments, external repositories, context routing, cross-repository Skills, and doctor warnings.
- [x] 11.3 Compare Astrail status and diagnostics with the existing Market workspace scripts and document intentional differences.
- [x] 11.4 Build an import preview that maps the Market-style configuration into Astrail declarations without modifying the source workspace.
- [x] 11.5 Document side-by-side adoption and rollback by removing generated projections while preserving original workspace scripts and repositories.

## 12. Documentation, Security, and Release Verification

- [x] 12.1 Document the author workflow: `init → define → validate → publish Distribution`.
- [x] 12.2 Document the developer workflow: `clone/use Distribution → bootstrap → open root in Codex → work → doctor/update/sync`.
- [x] 12.3 Document package identity versus exposed alias so users never need to remember capability namespaces during normal work.
- [x] 12.4 Document advisory-policy semantics and clearly distinguish invalid configuration, warnings, and optional strict mode.
- [x] 12.5 Add security tests for hostile instructions in content-only repositories, secret redaction, untrusted Plugin introduction, and integrity drift.
- [x] 12.6 Add cross-platform projection tests covering link, copy, and manifest strategies where supported.
- [x] 12.7 Run strict OpenSpec validation, full package checks, CLI end-to-end tests, and Codex fixture verification before the alpha release.

## 13. Follow-up Roadmap Changes

- [x] 13.1 Create a follow-up OpenSpec change for the permissioned executable Plugin SDK and provider lifecycle after declarative extension boundaries are proven.
- [x] 13.2 Create a follow-up change for Astrail MCP Resources, Tools, and prompt or meta-Skill contributions using the same core resolver.
- [x] 13.3 Create a follow-up change for a second agent target and extract a shared Adapter interface only from demonstrated common behavior.
- [x] 13.4 Create a follow-up change for registry discovery, signing, organization policy packs, and compatibility reporting.
- [x] 13.5 Create a follow-up change for a UI backed exclusively by the Astrail core API after CLI result contracts stabilize.
