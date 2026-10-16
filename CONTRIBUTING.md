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

## Resource maintenance

`public-resources/` contains the static files uploaded by `.github/workflows/pages.yml`. Validate them with `corepack pnpm resources:check`. The workflow deploys changes on `main` and supports manual deployment.

`resource-integrity.json` records immutable versioned files and their SHA-256 digests. `release-manifest.json` records public source commits and resource entries. Add versions without removing earlier entries. Schema files must match the corresponding npm package bytes. Stable aliases are promoted only after the exact-version resources and packages pass verification. The validator compares the previous Git revision when `ASTRAIL_RESOURCE_BASE` is set; CI supplies the previous main revision or PR base.

Remove credentials, private endpoints, and personal data from examples and logs. The complete documentation site and synchronization bookkeeping are maintained separately.
