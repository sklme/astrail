## Why

The alpha context router makes selection decisions from static task keywords, repository IDs, paths, environments, operations, and scopes without production evidence that those rules improve an agent's work. Astrail should provide an inspectable and safe context catalog while leaving investigation and relevance judgments to the agent until routing has been validated through real usage and evaluation.

## What Changes

- **BREAKING** Remove context `routing` and `dependsOn` declarations from the alpha Workspace schema.
- **BREAKING** Remove task-based context resolution and the `astrail context resolve|explain` commands.
- Keep deterministic context discovery with identity, kind, resolved location, summary, provenance, trust, sensitivity, freshness, priority, scope, and optional budget metadata.
- Add `astrail context show <id>` for inspecting one catalog entry and `astrail context load <id>` for explicitly retrieving file content or glob matches.
- Keep progressive disclosure and prevent secret context from being emitted as plaintext.
- Update Codex guidance, examples, fixtures, tests, generated schema artifacts, and roadmap language so Astrail presents context sources rather than choosing them for the agent.
- Treat any future recommendation, ranking, or automatic routing as an experimental capability that requires real-world evaluation before becoming a core contract.

## Capabilities

### New Capabilities

- `context-catalog`: Deterministic, provenance-aware discovery and explicit loading of declared context sources without automatic task relevance decisions.

### Modified Capabilities

None. The earlier context-routing contract has not been archived into the main specification set; this change supersedes that active planning direction with the narrower context-catalog capability.

## Impact

- Removes public schema fields, exported Core routing types/functions, and two CLI subcommands during the `v1alpha1` stage.
- Adds explicit context inspection and loading commands backed by the existing Core catalog and content loader.
- Changes example manifests and Market migration expectations but does not alter repository, capability, lifecycle, or projection ownership semantics.
- Leaves Agent reasoning responsible for deciding which discovered context is relevant to a task.
