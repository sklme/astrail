# Astrail

Chart the working trail for every agent.

Astrail organizes repositories, environments, shared configuration, context, and Skills into a workspace that AI agents can discover. Work stays in your real repositories. The CLI validates configuration, previews changes, prepares repositories, and generates Codex guidance and editor workspaces.

## Quick start

Node.js 22.12+ and Git are required. A global CLI is convenient when you maintain several workspaces:

```sh
npm install -g astrail@0.13.0
astrail --cwd ./my-workspace init --name my-workspace --runtime global
cd my-workspace
astrail --json status
astrail install --dry-run
astrail install --yes
```

Global initialization creates workspace configuration and an editor workspace without adding or installing a local CLI dependency. Review install output before applying. Configuration setup Skills are handed to your agent for execution; resource availability does not mean setup has completed.

For a team-pinned local CLI, use `astrail init --runtime local`. Commit the generated package.json and lockfile and install them on other machines. Local mode requires a valid installation in the workspace's own node_modules. Local installation defaults to pnpm 11.20.0, which requires Node.js 22.13+.

## Install and update

Use `init` to create the workspace definition, `install` to prepare resources and automatically maintain `astrail.lock.yaml`, and `update` to refresh remote dependencies and synchronize caches, locks, Skills, and editor projections. Commit the manifest and lockfile. Matching locked Git commits are restored when caches are missing; repeated install does not follow moving branches.

```sh
astrail update --dry-run
astrail update --yes
```

Update refreshes Git branches and HTTP configs; fixed tags and commits remain locked. Existing business repository branches and local changes are preserved. Dry-run stays offline and lists sources to check, rather than verified remote revisions. A failed acquisition, validation, or synchronization restores managed state; newly cloned business repositories remain available.

`bootstrap` is a compatibility alias for install. `sync` retains its projection/editor scope, and `lock` remains available; neither is an extra step in the normal workflow. `update --restore` restores only the previous lockfile. The CLI itself is upgraded through its package manager.

## Runtime preferences and upgrades

Selection priority is `astrail.local.yaml`, then `astrail.yaml`, then the user preference, then legacy automatic selection. In a workspace manifest, add `runtime: { mode: global }` or `runtime: { mode: local }`. Personal workspace overrides need the local overlay headers:

```yaml
apiVersion: astrail.dev/v1alpha1
kind: WorkspaceLocal
runtime:
  mode: global
```

To use one CLI across all workspaces without an explicit mode, create `~/.config/astrail/config.yaml` containing:

```yaml
runtime:
  mode: global
```

`XDG_CONFIG_HOME` relocates the config directory; `ASTRAIL_USER_CONFIG` selects an explicit user config file. User config supports only runtime preferences. Shared fragments loaded through extends cannot choose an executable. `init --runtime` persists an explicit workspace choice; inherited user defaults are not pinned into the workspace.

Upgrade the global launcher to 0.10.0 or a newer compatible version before using this setting. Older launchers and directly invoked old local CLIs do not understand it. Run the global `astrail` command, rather than `pnpm exec astrail`, in global mode. The new launcher reads preferences before inspecting or delegating to obsolete local dependencies, so existing local packages may remain installed. Global mode uses the invoking CLI (including an explicit one-shot launcher); it does not search other Node installations for a global executable.

Both modes enforce workspace and shared-config `requires.astrail` ranges. A range such as `>=0.9.0 <0.10.0` must be reviewed and migrated before using 0.10.0. This release also removes the obsolete workspace import command; Skill import remains available. Ordinary commands never automatically upgrade the CLI.

Use `astrail status --json` to inspect `runtime.version`, `mode`, `modeSource`, `source` (`launcher` or `local`), and `executable`. With no mode configured, legacy behavior is preserved: prefer an installed local CLI, require declared dependencies to be installed, and otherwise use the invoking CLI. Global built-in Skills are copied into the workspace so replacing the installation cannot break links; review `astrail install --dry-run` and apply `astrail install` to migrate existing links or refresh copies. Manifest-only projection remains unchanged.

After switching and syncing, optionally remove only the obsolete CLI dependency with the workspace's package manager. Other dependencies and lockfile contents are preserved by configuration changes. Use `--help` for command options and `--json` for structured output.

## Configuration and resources

See [the minimal workspace](examples/minimal/astrail.yaml) and [shared configuration examples](examples/configs). Repository URLs in examples are placeholders; replace them with your own. Examples containing adjacent files should be consumed as a directory or pinned Git source, rather than as a standalone HTTP file.

[Public resources](https://sklme.github.io/astrail/) provide [Schema](https://sklme.github.io/astrail/schema/index.json), [template](https://sklme.github.io/astrail/templates/index.json), and [shared configuration](https://sklme.github.io/astrail/configs/index.json) indexes. Template and shared configuration catalogs are currently empty. Schema validation runs locally from the installed package. The `astrail.dev/v1alpha1` configuration protocol is versioned independently from npm packages.

## Documentation and task records

Version 0.11.0 removes the bundled `astrail-records` Skill and its default documentation rules. Documentation workflows can be selected through existing shared configuration. Existing docs, task records, and user-authored guidance are preserved. After upgrading, review `astrail install --dry-run` before applying; locally modified legacy Skill entries are preserved with an `ASTR5030` diagnostic until reconciled.

## Packages

| Package | Purpose |
| --- | --- |
| `astrail` | CLI and workspace-local runtime |
| `astrail-core` | Portable configuration, lifecycle, and diagnostics |
| `astrail-schema` | JSON Schemas and generated types |
| `astrail-target-codex` | Codex guidance and built-in Skills |
| `astrail-templates` | Versioned template catalog (currently empty) |

Public releases started at 0.9.1. Package changelogs also describe earlier development versions that were not published through this repository. Full documentation is not included here. This README, CLI help, examples, and public resources provide the public usage entry points.

## Development

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm resources:check
```

The package manager and development tools are pinned in this repository. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution and release model, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[Apache-2.0](LICENSE)
