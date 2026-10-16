# Design

## Context

See proposal.md. Core already resolves Git/local/subpath roots and composes local overrides. CLI orchestrates onboarding and Codex projection; it is the appropriate place for IDE process launch. Environment checkout currently changes branches in-place.

## Goals / Non-Goals

Keep a reusable pure preview plus guarded writer in core. Keep platform-specific discovery and process spawning in CLI. No editor settings inside user repositories, no filesystem symlink collection, and no implicit launch from onboarding.

## Decisions

- Add an `editor` configuration object to shared/local schemas. Use existing composition and provenance; default values are applied by the editor planner. Restrict filenames to plain root-level basenames ending in `.code-workspace`. Executable strings are single executable names or paths, never shell commands; recommend local overrides for machine paths.
- Use JSONC parsing and surgical folder edits instead of rewriting whole user documents. Record only folders inserted by Astrail in `.astrail/editor-workspace.json`, indexed by workspace filename. Remove only unchanged owned entries; changed entries become user-owned. Existing matching entries remain user-owned. Preserve other properties and comments. Renaming the output leaves the old file intact and retains its ignore entry and ownership record.
- Include repository roots only, not the coordinator root by default, so opening a parent coordinator does not duplicate all repositories. No available repositories yields an empty folders array. Missing paths are warnings for the editor workflow; invalid declarations still block writes.
- Use exact `.gitignore` entries for generated files and ownership state, preserving existing content. Plan all edits, refuse symlink/non-file destinations, acquire the operation lock and recheck source contents before atomic file writes. Multi-file failures report diagnostics; no destructive rollback.
- Expose `editor list` for machine-readable editor/command discovery and `editor sync` for standalone file repair, alongside `open`. Also synchronize during existing `sync`, init, repository-add completion, and bootstrap. Lifecycle preview shows the file work; no launch occurs without `open`.
- Resolve IDE commands using configured executable overrides first, platform IDE launchers second. CodeBuddy IDE must not use the ambiguous terminal `codebuddy` command. On macOS locate the installed IDE bundle launcher; other systems can use the IDE-specific launcher or a configured path. Spawn without a shell, bound launcher waiting, and report dispatch rather than claiming an editor window was visually verified.
- Add a built-in Skill and managed guidance using the existing Codex projection ownership model. Add an additive built-in editor descriptor to capability discovery without treating it as a declared capability.

## Risks / Trade-offs

- User-modified managed folders become manual → conservative preservation may retain an old entry; report ownership behavior in docs.
- Launcher variants differ by OS → injectable launcher tests, explicit executable override, macOS local evidence, and actionable missing-launcher diagnostics.
- Files are local projections → ignore generated outputs, keep YAML as the team source of truth, retain old files on rename.
- Workspace access metadata remains advisory → do not claim IDE edit restrictions or bypass editor workspace trust.

## Migration Plan

Existing manifests retain defaults. First sync creates or safely merges the workspace and local ownership state. New schema keys require this release; removal of the keys restores older manifest compatibility. Generated files may be removed manually; no source repositories are changed.
