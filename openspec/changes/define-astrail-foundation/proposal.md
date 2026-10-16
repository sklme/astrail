## Why

AI coding agents can work across multiple repositories, but they lack a portable, tool-readable control plane that tells them which repositories, environments, instructions, context sources, capabilities, and advisory policies apply to a task. Astrail will provide that foundation as an open-source, agent-oriented workspace engine: **“Astrail — Chart the working trail for every agent.”** / **“为每个 Agent 规划正确的工作航迹。”**

## What Changes

- Establish Astrail as a general-purpose, open-source advisory control-plane engine rather than a monorepo, mandatory Git gateway, or replacement for an AI coding agent.
- Introduce a versioned `astrail.yaml` workspace definition, machine-local overrides, a generated lock file, JSON Schema validation, and a resolver that separates declared, local, resolved, and locked state.
- Model repositories as managed Git, linked local, or derived subpath working roots with explicit requiredness, advisory access, role, revision, and instruction trust; model environments independently from Git branch roles.
- Introduce task-scoped context routing so agents receive stable instructions and discover relevant specifications, documentation, generated state, and external resources without eagerly loading all workspace content.
- Introduce capability resolution for workspace Skills, child-repository Skills, global or registry Skills, tools, and plugins, with stable package identities, short exposure aliases, dependency modes, conflict detection, and advisory recommendations.
- Define the Astrail lifecycle and CLI contract for authoring, consuming, inspecting, synchronizing, updating, and diagnosing a workspace while leaving normal code development in the native agent experience.
- Define reusable Workspace Distributions as declarative bundles of defaults, context packs, Skills, and plugin requirements; reserve executable Plugins for explicit engine extension points.
- Provide a Codex-first projection that renders resolved Astrail state into files and configuration Codex can discover from the workspace root.
- Define an incremental roadmap: foundation and read-only resolution first; reproducible setup and update second; MCP, executable Plugin SDK, additional agent adapters, registry, and UI only after the core model stabilizes.
- Keep policy enforcement advisory by default: Astrail reports invalid configuration as errors and policy deviations as warnings, but does not intercept direct Git or filesystem operations.

## Capabilities

### New Capabilities

- `workspace-definition`: Versioned Astrail manifests and the core model for repositories, environments, context sources, capabilities, operations, advisory policies, local state, and lock state.
- `context-routing`: Task-scoped discovery, selection, provenance, trust, priority, freshness, sensitivity, and explainability for agent context.
- `capability-resolution`: Resolution and exposure of Skills, tools, context packs, and plugins across built-in, workspace, child-repository, global, registry, and distribution sources.
- `workspace-lifecycle`: CLI-visible workflows for initialization, bootstrap, validation, status, doctor, synchronization, update previews, and lock management.
- `workspace-distribution`: Reusable, composable Workspace Distributions that specialize the open-source engine for organizations, technology stacks, and product families without changing the core.
- `codex-workspace-integration`: Codex-first projection and native daily-development experience from the Astrail workspace root.

### Modified Capabilities

None. This repository does not yet contain main specifications.

## Impact

- Introduces the initial public product contract, terminology, file conventions, diagnostics, and CLI behavior for Astrail.
- Establishes `astrail` as the future CLI and `astrail.yaml`, `astrail.local.yaml`, and `astrail.lock.yaml` as the configuration family.
- Requires a future core library, schema package, CLI, Codex projection, reference Workspace Distribution, and conformance fixtures.
- Uses the existing multi-repository Market workspace as a design input and future compatibility fixture, but keeps all company-specific repositories, environments, Skills, and services outside the open-source core.
- Defers application code, UI, arbitrary executable Plugin SDK, company-specific providers, central registries, and non-Codex adapters to later implementation phases or changes.
