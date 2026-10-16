## Internal setup resources

Resolve setup against the effective capability identities as before. Every active Skill referenced by a setup entry uses `.astrail/setups/<effective-alias>/`. Daily Skills retain their existing destination and projection strategy. Local setup resources are managed copies even when daily projection uses links or manifest entries, ensuring the absolute handoff path is readable. Direct Git setup uses existing acquisition, trust, digest, commit, ownership, and lock machinery. No new schema flag or execution mode is introduced.

The projection manifest continues to own internal resources so sync, doctor, and lock can account for them. Changing an alias follows the normal desired-artifact reconciliation. `mode: none` and omission affect only the declaring config; removing a setup declaration does not disable its capability, which becomes a normal Skill unless also removed or disabled.

## Initialization handoff

Bootstrap returns setup entries in existing dependency order with declaring config, identity, alias, path, and `planned`, `blocked`, or `available` status. Only available entries include the Agent continuation instruction. Human output and generated AGENTS guidance express the same contract: completing Workspace initialization includes reading and completing setup within the same request. Check existing configuration before changing it, and report unresolved credentials or login as unfinished initialization.

The CLI does not interpret or execute Skill instructions. Setup resources can be available without configuration or authentication having succeeded. No persistent completion state is added. Read-only inspection and ordinary sync do not request Agent setup execution.

## Legacy migration

The sync preview shows internal preparation and removal of the owned daily entry. Unchanged local resources are copied from their declared source. An intact legacy Git copy whose source coordinates and expected digest still match is copied internally without network, preserving its resolved commit and integrity. Old entries are removed only after replacements are prepared. Modified legacy copies, replaced links, and unowned destinations block migration; checks are repeated before writes. Original local sources are retained.

## Validation

Cover local config resources, Git resources, alias overrides, all daily projection strategies, idempotency, health checks, offline previews, legacy migration and conflicts, missing/disabled/untrusted setup, dependency ordering, no-setup semantics, and both CLI handoff formats. Validate the OpenSpec change and build the documentation.
