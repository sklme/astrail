## ADDED Requirements

### Requirement: Workspace setup uses explicit Astrail declarations
The CLI SHALL support workspace creation through `astrail init` and SHALL reject the removed top-level `import` command as unknown. The core package SHALL omit the legacy workspace conversion API from its public entrypoint.

#### Scenario: A caller invokes the removed workspace importer
- **WHEN** a caller invokes the top-level `import` command, with or without `--json`
- **THEN** the CLI reports an unknown command, exits unsuccessfully, and does not modify workspace files

#### Scenario: A caller uses supported onboarding
- **WHEN** a caller requests workspace initialization or `skill import` help
- **THEN** the corresponding supported command remains available

### Requirement: Distributions omit obsolete compatibility content
Internal and public source distributions SHALL omit the legacy importer implementation, its compatibility fixtures, and its command documentation. Package outputs SHALL omit the deleted implementation after a rebuild.

#### Scenario: A maintainer builds a package after the removal
- **WHEN** the package is built from a clean checkout
- **THEN** its public exports and package contents contain no legacy workspace importer
