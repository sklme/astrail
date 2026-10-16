## Why

The legacy workspace importer and its compatibility examples are no longer needed in either distribution. Keeping them exposes an unused CLI command and core API and adds unrelated project context to the repository.

## What Changes

- **BREAKING** Remove the top-level workspace `import` command and the legacy conversion API from the core package.
- Delete the compatibility fixtures and importer-specific test.
- Remove the corresponding command documentation and obsolete design references.
- Keep `astrail init`, repository onboarding, and `astrail skill import` unchanged.

## Non-goals

No replacement importer, configuration migration, manifest schema change, or modification of user workspaces. Previously published packages remain immutable; this removal takes effect in the next release.

## Impact

Both internal and public source distributions receive the same removal. Consumers of the old conversion API or CLI command must define an Astrail workspace explicitly. A minor release is required for this breaking change while the packages are below 1.0.
