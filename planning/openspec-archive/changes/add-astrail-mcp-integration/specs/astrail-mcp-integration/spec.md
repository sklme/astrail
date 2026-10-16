## ADDED Requirements

### Requirement: MCP exposes the core resolved model

Astrail SHALL expose MCP Resources and read-only Tools from the same typed resolver and result contracts used by the CLI, without maintaining a second workspace model.

#### Scenario: An MCP client discovers context

- **WHEN** an authorized MCP client lists the Workspace context catalog
- **THEN** Astrail returns the same lightweight context metadata and retrieval locations as core resolution
- **AND** Astrail does not select, exclude, or recommend entries based on inferred task relevance

#### Scenario: An MCP client explicitly retrieves context

- **WHEN** an authorized MCP client requests one declared context source by identity
- **THEN** Astrail retrieves only that source through the same Core loading contract
- **AND** protected content is not returned unless the request passes its sensitivity rules

#### Scenario: A client discovers state-changing Tools

- **WHEN** the initial MCP integration is configured with its default permissions
- **THEN** state-changing Tools are unavailable
- **AND** read-only inspection remains available
