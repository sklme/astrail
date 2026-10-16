# Astrail

Chart the working trail for every agent.

Astrail organizes repositories, environments, shared configuration, context, and Skills into a workspace that AI agents can discover. Work stays in your real repositories. The CLI validates configuration, previews changes, prepares repositories, and generates Codex guidance and editor workspaces.

## Quick start

Requires Node.js 22.12 or newer, Git, and pnpm (11.20.0 is the default for new workspaces).

```sh
mkdir my-workspace
cd my-workspace
pnpm dlx astrail@0.9.1 init --name my-workspace
pnpm exec astrail --json status
pnpm exec astrail bootstrap --dry-run
pnpm exec astrail bootstrap --yes
```

`init` writes `astrail.yaml` and a workspace-local CLI dependency, then installs it. Review bootstrap output before applying. Bootstrap prepares declared resources and projects built-in Skills; configuration setup Skills are handed to your agent for execution. Resource availability does not mean setup has completed.

```sh
pnpm exec astrail repo add --help
pnpm exec astrail skill --help
pnpm exec astrail config show
pnpm exec astrail doctor
pnpm exec astrail open --dry-run
```

Use `--help` on any command for supported options and `--json` for structured output. A global or one-shot launcher delegates to the workspace-local version. Keep the dependency and lockfile committed when upgrading.

## Configuration and resources

See [the minimal workspace](examples/minimal/astrail.yaml) and [shared configuration examples](examples/configs). Repository URLs in examples are placeholders; replace them with your own. Examples containing adjacent files should be consumed as a directory or pinned Git source, rather than as a standalone HTTP file.

[Public resources](https://sklme.github.io/astrail/) provide [Schema](https://sklme.github.io/astrail/schema/index.json), [template](https://sklme.github.io/astrail/templates/index.json), and [shared configuration](https://sklme.github.io/astrail/configs/index.json) indexes. Template and shared configuration catalogs are currently empty. Schema validation runs locally from the installed package. The `astrail.dev/v1alpha1` configuration protocol is versioned independently from npm packages.

## Packages

| Package | Purpose |
| --- | --- |
| `astrail` | CLI and workspace-local runtime |
| `astrail-core` | Portable configuration, lifecycle, and diagnostics |
| `astrail-schema` | JSON Schemas and generated types |
| `astrail-target-codex` | Codex guidance and built-in Skills |
| `astrail-templates` | Versioned template catalog (currently empty) |

This is the first public source synchronization, at version 0.9.1. Package changelogs also describe earlier development versions; those versions were not published through this repository. Full documentation is not included here. This README, CLI help, examples, and public resources provide the public usage entry points.

## Development

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm resources:check
```

The package manager and development tools are pinned in this repository. See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution and release model, and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

[Apache-2.0](LICENSE)
