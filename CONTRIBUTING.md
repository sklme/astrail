# Contributing to Astrail

Issues and pull requests are welcome. Create a focused branch from `main`, use Conventional Commit messages, and explain the user-visible behavior and compatibility impact. Public behavior changes should include an OpenSpec change and meaningful tests. Package code imports other packages through their public exports.

Use Node.js 22.13+ and the pnpm version in `package.json`:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check
corepack pnpm resources:check
```

OpenSpec is a pinned development dependency; a separate global installation is unnecessary.

## Synchronization and releases

Development changes are integrated into the maintained development source and then synchronized into this repository. Accepted contributions retain their attribution. Each public release identifies its public source commit. Keep distribution-specific package names, registry settings, and public URLs here; the core implementation follows the matching source release.

All six workspace packages share a version; the root and `astrail-testing` remain private. Publishable packages use npm's public registry. Validate actual package archives and install them in an isolated workspace before publishing. Publish new versions with a candidate tag, verify registry installations and resources, then advance stable tags. Prereleases and older-version retries must not roll stable entries backward. Never replace a published version or move a published tag.

Use **Publish npm packages** (`npm-publish.yml`) on `main`, with the exact synchronized `version` and `operation=publish`. Deploy the version's fixed resources before starting it. The workflow builds and checks the source, inspects all five archives, publishes missing versions in dependency order, verifies registry downloads and a fresh installation, then advances `latest` (stable) or `next` (prerelease) without moving a tag backward. Existing versions are accepted only when their archive digests match. Inspect the run artifacts before resuming a failed release.

Publishing uses npm Trusted Publishing through the `npm-publish` GitHub Environment, restricted to `main`. Each of the five packages must authorize `sklme/astrail`, workflow `npm-publish.yml`, environment `npm-publish`, with direct publish and dist-tag permissions. No stored npm token is used. Repository maintainers explicitly dispatch a release; pushes and pull requests do not publish packages.

The `verify` operation uses an already-published version. It checks archives and installation, then creates and removes a run-specific `oidc-check-*` tag on each package to exercise authenticated writes without republishing a version or changing stable tags. If a run is interrupted, inspect and remove only its temporary verification tags. This verifies OIDC tag access; the first publication of a new version also verifies publish access and provenance. After npm succeeds, promote the verified resource aliases and create the version's GitHub Release as part of the synchronization task.

## Resource maintenance

`public-resources/` contains the static files uploaded by `.github/workflows/pages.yml`. Validate them with `corepack pnpm resources:check`. The workflow deploys changes on `main` and supports manual deployment.

`resource-integrity.json` records immutable versioned files and their SHA-256 digests. `release-manifest.json` records public source commits and resource entries. Add versions without removing earlier entries. Schema files must match the corresponding npm package bytes. Stable aliases are promoted only after the exact-version resources and packages pass verification. The validator compares the previous Git revision when `ASTRAIL_RESOURCE_BASE` is set; CI supplies the previous main revision or PR base.

Remove credentials, private endpoints, and personal data from examples and logs. The complete documentation site and synchronization bookkeeping are maintained separately.
