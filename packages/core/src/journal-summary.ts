import type { JournalChange, JournalValues } from "./journal-trace.js"

// Derived on read so old records benefit too; raw changes remain the evidence.
// Missing snapshots are unknown, never interpreted as proof of an addition or
// content update. A remove/project pair only proves the projection was refreshed.
export function summarizeJournalChanges(changes: readonly JournalChange[]): string[] {
  const groups = new Map<string, [JournalChange, ...JournalChange[]]>()
  for (const change of changes) {
    const key = `${change.kind}:${change.target}`
    const group = groups.get(key)
    if (group) group.push(change)
    else groups.set(key, [change])
  }
  return [...groups.values()]
    .sort((a, b) => Number(a[0].kind === "file") - Number(b[0].kind === "file"))
    .map((group) => {
      const first = group[0]
      const last = group[group.length - 1] ?? first
      const before = first.before
      const after = last.after
      const name = after?.identity ?? before?.identity ?? last.target
      const versions =
        transition(before, after, "version") ||
        transition(before, after, "revision") ||
        transition(before, after, "resolvedCommit")
      const suffix = versions ? ` (${versions})` : ""
      if (last.kind === "projection") {
        if (last.action === "project-incomplete") return `Incomplete projection ${name}`
        if (after === null) return `Removed projection ${name}`
        if (group.some((item) => item.action === "remove") || before) {
          if (before?.integrity && after?.integrity)
            return before.integrity === after.integrity
              ? `Refreshed projection ${name} (content unchanged)${suffix}`
              : `Updated projection ${name}${suffix}`
          return `Refreshed projection ${name}${suffix}`
        }
        return `${before === null ? "Added" : "Prepared"} projection ${name}${suffix}`
      }
      if (last.kind === "config") return `Acquired config ${name}${suffix}`
      if (last.kind === "repository" && last.action === "checkout")
        return `Switched repository ${last.target}: ${branch(before)} → ${branch(after)}`
      if (last.kind === "repository")
        return `${last.action === "clone" ? "Cloned" : "Registered"} repository ${last.target}${suffix}`
      if (last.kind === "skill") return `Declared Skill ${name}${suffix}`
      if (last.kind === "environment") return `Declared environment ${last.target}`
      if (last.kind === "lock") return `Resolved lock ${last.target}${suffix}`
      if (after === null) return `Removed file ${last.target}`
      if (before?.digest && before.digest === after?.digest) return `Restored file ${last.target}`
      return `${before === null || last.action === "create" ? "Created" : "Updated"} file ${last.target}`
    })
}

function transition(
  before: JournalValues | null | undefined,
  after: JournalValues | null | undefined,
  key: string,
): string {
  const next = after?.[key]
  if (typeof next !== "string" || !next) return ""
  const previous = before?.[key]
  const display = (value: string) => (key === "version" ? value : value.slice(0, 12))
  return typeof previous === "string" && previous !== next
    ? `${display(previous)} → ${display(next)}`
    : display(next)
}

function branch(value: JournalValues | null | undefined): string {
  return value?.branch === null ? "detached" : String(value?.branch ?? "unknown")
}
