import { describe, expect, it } from "vitest"
import { summarizeJournalChanges } from "./journal-summary.js"

describe("journal summaries", () => {
  it("distinguishes projection refresh, verified content change, additions and removals", () => {
    expect(
      summarizeJournalChanges([
        {
          kind: "projection",
          target: "a",
          action: "remove",
          before: { identity: "team/a", integrity: "same" },
          after: null,
        },
        {
          kind: "projection",
          target: "a",
          action: "project",
          before: null,
          after: { identity: "team/a", integrity: "same" },
        },
        {
          kind: "projection",
          target: "b",
          action: "remove",
          before: { integrity: "old" },
          after: null,
        },
        { kind: "projection", target: "b", action: "project", after: { integrity: "new" } },
        {
          kind: "projection",
          target: "c",
          action: "project",
          before: null,
          after: { identity: "team/c" },
        },
        {
          kind: "projection",
          target: "d",
          action: "remove",
          before: { identity: "team/d" },
          after: null,
        },
      ]),
    ).toEqual([
      "Refreshed projection team/a (content unchanged)",
      "Updated projection b",
      "Added projection team/c",
      "Removed projection team/d",
    ])
  })

  it("shows entity names and version transitions before file details, with unknown branches explicit", () => {
    expect(
      summarizeJournalChanges([
        {
          kind: "file",
          target: "AGENTS.md",
          action: "write",
          before: { digest: "old" },
          after: { digest: "new" },
        },
        {
          kind: "config",
          target: "opaque-cache-key",
          action: "clone",
          after: { identity: "team-config", revision: "0123456789abcdef" },
        },
        {
          kind: "lock",
          target: "capabilities/a",
          action: "resolve",
          before: { version: "1.0.0" },
          after: { version: "1.1.0" },
        },
        { kind: "repository", target: "api", action: "checkout", after: { branch: "feature" } },
      ]),
    ).toEqual([
      "Acquired config team-config (0123456789ab)",
      "Resolved lock capabilities/a (1.0.0 → 1.1.0)",
      "Switched repository api: unknown → feature",
      "Updated file AGENTS.md",
    ])
  })
})
