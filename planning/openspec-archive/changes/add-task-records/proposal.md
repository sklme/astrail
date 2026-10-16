## Why

Agents tend to place task timelines, evidence, and proposals in `docs/` when a Workspace provides no writing convention. This makes reusable knowledge harder to find and duplicates material owned by project repositories.

## What Changes

- Add concise repository-first records and documentation guidance to the Codex managed region.
- Project the built-in `astrail-records` Skill for recording, continuing, handing off, organizing, and distilling task material.
- Default new records to `records/YYYY-MM-DD-topic/README.md`, with optional evidence, while honoring explicit user directions and established project conventions.
- Document the convention in the Astrail Pages repository.

## Non-goals

No new manifest fields or record management commands; no automatic creation or migration of business material; no filesystem enforcement or automatic semantic classification of documents.

## Impact

Only the Codex target and its bundled Skill change. Records and docs remain user-owned. Existing Workspace configuration remains valid, and synchronization preserves user-authored guidance outside the managed region.
