## Purpose

Lets an agent guide users through repository Skill discovery and selective exposure while delegating validation, planning, mutation, and synchronization to Astrail's reviewed CLI contracts.

## ADDED Requirements

### Requirement: Agent Skill discovers before proposing imports
The target-owned Skill-management Agent Skill SHALL recognize requests to find or reuse Skills from child repositories, invoke machine-readable discovery for the requested repositories or all repositories, and present the returned candidates and conflicts without claiming that discovery exposes them.

#### Scenario: User asks what repository Skills are available
- **WHEN** a user asks the agent to find Skills across child repositories
- **THEN** the Agent Skill invokes JSON discovery and summarizes candidates with repository provenance and current exposure state

#### Scenario: Repository scope is explicit
- **WHEN** a user names repository `platform`
- **THEN** the Agent Skill limits discovery to `platform` rather than scanning unrelated repositories

### Requirement: Agent Skill collects an explicit selection
The Agent Skill SHALL ask the user which candidates to add when the selection is not already unambiguous, SHALL preserve unselected candidates, and SHALL surface identity, alias, conflict, and instruction-trust choices required for a valid import request.

#### Scenario: Multiple candidates require selection
- **WHEN** discovery returns multiple importable candidates and the user has not selected among them
- **THEN** the agent presents the candidates and obtains an explicit subset before previewing import

#### Scenario: User selects some candidates
- **WHEN** the user chooses two of five candidates
- **THEN** the Agent Skill builds an import request containing exactly those two candidates

### Requirement: Agent Skill uses the reviewed batch contract
The Agent Skill SHALL invoke JSON import preview, present the exact normalized additions and plan identifier, apply only after explicit user confirmation, and treat synchronization as a second preview and authorization. It SHALL NOT edit Astrail YAML directly or infer instruction trust from repository presence.

#### Scenario: User approves import only
- **WHEN** the user confirms the reviewed import plan but has not authorized synchronization
- **THEN** the Agent Skill applies the matching import plan and does not invoke synchronization

#### Scenario: User also requests exposure
- **WHEN** the user confirms import and separately confirms the synchronization preview
- **THEN** the Agent Skill invokes the authorized synchronization contract after import succeeds
