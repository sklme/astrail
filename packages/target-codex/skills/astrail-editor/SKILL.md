---
name: astrail-editor
description: Open all Astrail repositories in VS Code, Cursor, or CodeBuddy IDE, or synchronize their multi-root workspace file. Use for requests to open the project in an editor, view all repositories together, or repair the editor workspace.
---

# Astrail Editor

Astrail derives a local `.code-workspace` from its resolved repository configuration. Use the CLI instead of constructing a separate folder list.

- Discover supported editors and commands with `astrail --json editor list`. `astrail --json capability list` also advertises this built-in capability.
- Preview with `astrail --json open --editor <vscode|cursor|codebuddy> --dry-run`.
- When the user requests opening an editor, execute `astrail --json open --editor <vscode|cursor|codebuddy>`. Omit `--editor` to use the configured default. The request authorizes this local launch; no additional interactive confirmation is needed.
- When only synchronization is requested, use `astrail --json editor sync --dry-run`, then `astrail --json editor sync`. Initialization and repository addition synchronize files but do not authorize launching an editor by themselves.
- Use `--cwd <workspace-root>` when outside the workspace. All JSON commands are noninteractive.

Inspect `success`, `diagnostics`, `data.workspacePath`, `data.synchronized`, and `data.launch.status`. `dispatched` means the IDE launch request was accepted; it does not prove a window became visible. If launching fails after synchronization, the workspace file remains usable. Report the diagnostic and remediation; do not repeatedly launch or substitute another editor.

Configuration lives under `editor` in `astrail.yaml`, with personal overrides in `astrail.local.yaml`: `workspaceFile` is a root-level `.code-workspace` filename, `default` is the editor ID, and `executables.<editor>` is a single IDE executable path. Use `astrail config show --json` to inspect effective preferences. CodeBuddy IDE is distinct from the `codebuddy` terminal Agent; use its IDE launcher (`buddycn` or installed application launcher), not a prompt sent to the terminal Agent.

The generator preserves settings, tasks, launch configuration, and manually added folders. Missing repositories are skipped with warnings until prepared. Read-only repository metadata is advisory and does not enforce editor permissions. Do not alter editor workspace trust settings to suppress prompts.
