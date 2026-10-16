# astrail

Astrail CLI for agent-oriented multi-repository workspaces. The CLI runtime requires Node.js 22.12+ and Git; the default pnpm 11.20.0 workflow below requires Node.js 22.13+.

```sh
pnpm dlx astrail@0.9.1 init --name my-workspace
pnpm exec astrail bootstrap --dry-run
pnpm exec astrail bootstrap --yes
```

Run initialization in a new workspace directory. It installs a workspace-local CLI; later commands use that version. Review bootstrap's preview before applying changes.

See the [quick start and examples](https://github.com/sklme/astrail#quick-start). Use `astrail --help` and `astrail <command> --help` for command details. Runtime validation uses bundled Schemas; editor Schema links use the [public resource site](https://sklme.github.io/astrail/).
