## Purpose

Make Astrail immediately useful through a Codex-first projection while preserving a native Codex conversation and development workflow from the workspace root.

## ADDED Requirements

### Requirement: Codex projection is generated from resolved state
Astrail SHALL render the resolved workspace instructions, selected Skills, tool connections, and discovery entry points into locations and formats supported by the targeted Codex version.

#### Scenario: Bootstrap targets Codex
- **WHEN** a workspace is bootstrapped with Codex as its primary agent
- **THEN** Astrail renders a Codex projection and doctor reports whether Codex can discover every required artifact

### Requirement: Workspace instructions preserve user ownership
The Codex projection SHALL use a documented ownership model for `AGENTS.md` and MUST preserve user-authored instructions outside Astrail-managed content.

#### Scenario: User edits instructions outside managed region
- **WHEN** `astrail sync` regenerates Codex instructions
- **THEN** the user-authored section is preserved and the managed section reflects current resolved state

### Requirement: Skills use agent-visible aliases
The Codex projection SHALL expose each selected Skill under its resolved short alias so users and Codex do not need registry namespaces, source paths, or package installation directories to invoke it.

#### Scenario: User requests log analysis naturally
- **WHEN** a logging Skill is exposed as `loghelper` and its description matches the user's request
- **THEN** Codex can activate it without the user naming `example/loghelper` or a filesystem path

### Requirement: Codex can retrieve dynamic state through Astrail
Projected instructions or meta Skills SHALL direct Codex to structured Astrail commands for dynamic repository, environment, context, and capability state instead of embedding changeable values into static instructions.

#### Scenario: Branch mapping changes
- **WHEN** a repository branch role is updated in the workspace definition
- **THEN** Codex obtains the new mapping from Astrail state without requiring the branch value to be manually updated in a Skill

### Requirement: Codex development remains native
The integration SHALL NOT require a long-running Astrail chat proxy or a mandatory `astrail run` command for normal development after the workspace is prepared.

#### Scenario: Developer opens workspace in Codex
- **WHEN** the developer opens the workspace root and starts a normal conversation
- **THEN** Codex works directly with the real repositories using the projected instructions and capabilities

### Requirement: Projection drift is diagnosable
Astrail SHALL detect missing, stale, broken, ambiguous, or user-modified generated Codex artifacts and SHALL explain whether synchronization can repair them safely.

#### Scenario: Projected Skill link is broken
- **WHEN** a Codex-visible Skill target no longer exists
- **THEN** doctor reports the affected alias, canonical capability identity, and a safe synchronization action

### Requirement: Codex-specific behavior remains isolated
Codex-only settings SHALL reside in a target-specific extension or generated projection and MUST NOT alter portable repository, environment, context, capability, or Distribution semantics.

#### Scenario: Another agent target is added later
- **WHEN** a future target consumes the same workspace definition
- **THEN** core resolution remains valid without interpreting Codex-specific extension fields as portable behavior
