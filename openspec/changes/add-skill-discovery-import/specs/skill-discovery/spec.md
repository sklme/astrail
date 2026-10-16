## Purpose

Lets users inventory Skills already owned by declared repositories and selectively expose reviewed candidates as ordinary Workspace Capabilities without implicit activation.

## ADDED Requirements

### Requirement: Discovery scans explicit repositories without mutation
The system SHALL discover Skill candidates only from selected or all declared repositories whose local roots are available, SHALL inspect only documented repository-relative Skill conventions, and SHALL NOT fetch repositories, mutate manifests, write projection directories, or persist a discovery inventory.

#### Scenario: Discover one repository
- **WHEN** a caller requests discovery for repository `platform`
- **THEN** the result contains candidates found under the supported Skill directories beneath `platform` and leaves the Workspace unchanged

#### Scenario: Discover all repositories
- **WHEN** a caller requests discovery for all repositories
- **THEN** the system scans each locally available declared repository in deterministic repository order

#### Scenario: Requested repository is unavailable
- **WHEN** a selected declared repository has no available local root
- **THEN** discovery returns an attributable diagnostic and does not attempt network acquisition

#### Scenario: Unknown repository is selected
- **WHEN** a caller selects a repository identifier that is not declared in the Workspace
- **THEN** discovery fails with an attributable diagnostic and no mutation

### Requirement: Discovery returns reviewable deterministic candidates
Each discovered candidate SHALL identify its repository, safe repository-relative source path, Skill metadata, proposed canonical identity, proposed Capability ID and alias, instruction-trust state, source fingerprint, and whether it is already declared or conflicts with existing or discovered Capabilities. Candidate ordering and identifiers SHALL be deterministic for unchanged Workspace and repository content.

#### Scenario: Valid repository Skill is discovered
- **WHEN** a supported Skill directory contains a readable `SKILL.md` with valid frontmatter
- **THEN** the candidate reports repository provenance, metadata, deterministic defaults, trust state, and a source fingerprint

#### Scenario: Skill is already declared
- **WHEN** an existing Skill Capability references the same repository and relative path
- **THEN** the candidate is marked already declared and identifies the existing Capability

#### Scenario: Proposed alias conflicts
- **WHEN** two candidates or an existing Capability use the same proposed alias
- **THEN** each affected candidate reports the conflict instead of being silently renamed

#### Scenario: Invalid Skill metadata
- **WHEN** a discovered `SKILL.md` cannot supply the minimum valid Skill name
- **THEN** discovery returns an attributable candidate diagnostic and excludes it from importable selections

### Requirement: Selective import produces ordinary Capability declarations
The system SHALL accept an explicit subset of discovered candidates, allow reviewed identity, ID, alias, version, and instruction-trust overrides, and normalize each selection into an ordinary `kind: skill` Capability with `source.type: repository`. It SHALL reject unselected, unknown, invalid, already-declared, duplicated, escaping, or conflicting selections rather than implicitly importing them.

#### Scenario: Import a subset
- **WHEN** discovery returns three importable candidates and the caller selects two
- **THEN** the plan contains exactly two Capability additions and leaves the third candidate undeclared

#### Scenario: Keep Capability as the persisted model
- **WHEN** a selective import is applied
- **THEN** the manifest gains only normal `capabilities.<id>` entries and no package, cache, inventory, or repository Skill list

#### Scenario: Resolve an alias conflict with an override
- **WHEN** a selected candidate's proposed alias conflicts and the caller supplies a unique valid alias
- **THEN** the normalized plan uses the reviewed alias

#### Scenario: Selection is no longer discoverable
- **WHEN** an import request references a repository path that is not a current supported discovery candidate
- **THEN** planning fails with an attributable diagnostic and no manifest change

### Requirement: Batch import is previewed, atomic, and stale-safe
The system SHALL produce one deterministic plan for all selected additions, SHALL require explicit authorization and the matching plan identifier before apply in machine mode, SHALL detect manifest or selected-source changes after preview, and SHALL either verify every addition through composed Workspace resolution or restore the original manifest.

#### Scenario: Preview batch import
- **WHEN** a caller previews a valid selection
- **THEN** the result describes every Capability addition, the target manifest, file action, trust effect, and one deterministic plan identifier without writing files

#### Scenario: Apply the reviewed plan
- **WHEN** the caller supplies the unchanged selection, explicit authorization, and matching plan identifier
- **THEN** all selected Capability declarations are written atomically and verified

#### Scenario: Source changes after preview
- **WHEN** a selected `SKILL.md` changes after preview and before apply
- **THEN** apply refuses the stale plan and leaves the manifest unchanged

#### Scenario: One addition fails verification
- **WHEN** any selected addition cannot be verified after writing
- **THEN** the original manifest is restored and none of the batch remains applied

### Requirement: CLI supports human and machine discovery and import
The CLI SHALL expose `skill discover` for selected or all repositories and `skill import` for selective batch addition. Interactive import SHALL present numbered importable candidates and collect a subset before preview and confirmation; JSON mode SHALL emit stable structured candidates, diagnostics, plans, and results and SHALL never prompt.

#### Scenario: Interactive selective import
- **WHEN** a user runs interactive Skill import and chooses candidate numbers `1,3`
- **THEN** the CLI previews only candidates `1` and `3` and asks for confirmation before manifest mutation

#### Scenario: JSON discovery
- **WHEN** an agent invokes JSON discovery for all repositories
- **THEN** the CLI returns structured deterministic candidates without terminal prompts

#### Scenario: JSON import without authorization
- **WHEN** an agent invokes import apply without explicit authorization or the reviewed plan identifier
- **THEN** the CLI refuses mutation and returns a structured diagnostic

### Requirement: Import and projection remain separate authorizations
Selective import SHALL NOT clone repositories, acquire remote content, trust instructions implicitly, or write `.agents/skills`; exposing imported Skills SHALL continue to require the existing separately previewed synchronization operation.

#### Scenario: Import completes without projection
- **WHEN** a user applies a valid batch import
- **THEN** Capability declarations exist but `.agents/skills` is unchanged until a separately authorized synchronization

### Requirement: Repository and bootstrap workflows surface undeclared Skills
After a repository is applied, Astrail SHALL scan it when available and return structured discovered, imported, unimported, importable, candidate, trust, conflict, and unavailable-repository state. Bootstrap SHALL report the same compact inventory for all currently available declared repositories. Neither workflow SHALL import or project a Skill implicitly.

#### Scenario: Local repository is added with Skills
- **WHEN** an available linked local repository containing supported Skill directories is successfully added
- **THEN** the apply result immediately reports its unimported candidates and machine-readable next steps

#### Scenario: Managed Git repository is not materialized
- **WHEN** a Git repository is added before bootstrap creates its checkout
- **THEN** repository addition remains successful and the Skill inventory identifies the repository as unavailable instead of reporting a misleading complete zero count

#### Scenario: Human requests continuous import
- **WHEN** a terminal user invokes `repo add --import-skills` and confirms repository addition
- **THEN** Astrail continues into selective candidate choice, explicit trust, and a separately confirmed import plan without synchronizing projection artifacts

#### Scenario: Agent adds a repository
- **WHEN** an Agent applies a machine-readable repository plan
- **THEN** the result contains stable candidate metadata and next-step commands, while interactive `--import-skills` is rejected and the Agent must use an explicit selection file and reviewed import plan
