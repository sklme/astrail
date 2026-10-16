## Why

Agents that support MCP should be able to query the same resolved topology, context, capabilities, and operations as the CLI without introducing a second workspace model.

## What Changes

- Expose read-only Astrail Resources and Tools backed by `astrail-core` result contracts.
- Add context-catalog discovery and explicit per-source retrieval without eagerly copying protected content or deciding task relevance.
- Contribute prompt or meta-Skill guidance that points agents to Astrail MCP capabilities.
- Keep state-changing Tools separately permissioned and disabled in the first release.

## Capabilities

### New Capabilities

- `astrail-mcp-integration`: Serve resolved Astrail data, context-catalog inspection, and explicit progressive retrieval through MCP using the core resolver.

### Modified Capabilities

- None.

## Impact

This change will add an MCP server package, transport-neutral handlers, schemas derived from core types, target documentation, and conformance tests shared with the CLI.
