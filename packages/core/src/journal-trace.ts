import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { isAbsolute, relative, sep } from "node:path"
import { parse } from "yaml"
import type { Diagnostic } from "./types.js"

export type JournalValues = Record<string, string | number | boolean | null>
export interface JournalChange {
  kind: "file" | "repository" | "environment" | "skill" | "projection" | "config" | "lock"
  target: string
  action: string
  before?: JournalValues | null
  after?: JournalValues | null
}
export interface JournalTargets {
  repositories?: string[]
  environments?: string[]
  skills?: string[]
  planId?: string
  pendingRepositories?: string[]
  failedRepositories?: string[]
}

export interface JournalTrace {
  root: string
  changes: JournalChange[]
  changeCount: number
  targets: JournalTargets
  steps: JournalStep[]
  stepCount: number
  begin(): Promise<void>
}

export type JournalSkipReason = "no-actions" | "blocked" | "dry-run" | "unchanged"
export interface JournalStep {
  id: string
  parentId?: string
  name: string
  target?: string
  startedAt: string
  durationMs: number
  status: "success" | "failed" | "skipped"
  reason?: JournalSkipReason
  diagnosticCodes?: string[]
}

const stepContext = new AsyncLocalStorage<string>()

// Steps only collect observations in memory. They do not start a journal or turn
// read-only commands and successful no-ops into filesystem writes.
export async function journalStep<T>(
  name: string,
  operation: () => Promise<T>,
  options: {
    target?: string | undefined
    outcome?: (value: T) => { diagnostics?: Diagnostic[]; skipped?: JournalSkipReason | undefined }
  } = {},
): Promise<T> {
  const trace = journalTrace.getStore()
  if (!trace) return operation()
  const step = newStep(trace, name, options.target)
  const start = performance.now()
  try {
    return await stepContext.run(step.id, async () => {
      const value = await operation()
      // An observer failure must not change a successful operation's result.
      step.status = "success"
      try {
        const outcome = options.outcome?.(value)
        const diagnostics =
          outcome?.diagnostics ??
          (value &&
          typeof value === "object" &&
          "diagnostics" in value &&
          Array.isArray(value.diagnostics)
            ? (value.diagnostics as Diagnostic[])
            : [])
        step.diagnosticCodes = [...new Set(diagnostics.map((item) => item.code))]
        const failed =
          diagnostics.some((item) => item.severity === "error") ||
          (value && typeof value === "object" && "success" in value && value.success === false)
        step.status = failed ? "failed" : outcome?.skipped ? "skipped" : "success"
        if (!failed && outcome?.skipped) step.reason = outcome.skipped
      } catch {
        // The underlying operation completed; omit unavailable observation data.
      }
      return value
    })
  } catch (error) {
    step.status = "failed"
    step.diagnosticCodes = ["ASTR9001"]
    throw error
  } finally {
    step.durationMs = Math.max(0, Math.round(performance.now() - start))
  }
}

export function journalSkipStep(name: string, reason: JournalSkipReason, target?: string): void {
  const trace = journalTrace.getStore()
  if (!trace) return
  const step = newStep(trace, name, target)
  step.status = "skipped"
  step.reason = reason
}

function newStep(trace: JournalTrace, name: string, target?: string): JournalStep {
  const parentId = stepContext.getStore()
  const step: JournalStep = {
    id: `step-${++trace.stepCount}`,
    ...(parentId ? { parentId } : {}),
    name,
    ...(target ? { target } : {}),
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: "failed",
  }
  if (trace.steps.length < 200) trace.steps.push(step)
  return step
}

// A command scope collects completed effects across core and target adapters. Core
// APIs remain usable without a journal; callers can opt in with withWorkspaceJournal.
export const journalTrace = new AsyncLocalStorage<JournalTrace>()

export function isJournalRecording(): boolean {
  return journalTrace.getStore() !== undefined
}

export function journalTargets(targets: JournalTargets): void {
  const trace = journalTrace.getStore()
  if (!trace) return
  for (const key of ["repositories", "environments", "skills"] as const) {
    trace.targets[key] = [...new Set([...(trace.targets[key] ?? []), ...(targets[key] ?? [])])]
  }
  if (targets.planId) trace.targets.planId = targets.planId
  if (targets.pendingRepositories) trace.targets.pendingRepositories = targets.pendingRepositories
  if (targets.failedRepositories) trace.targets.failedRepositories = targets.failedRepositories
}

export async function journalBeforeMutation(): Promise<void> {
  // Observability must never turn a completed mutation into a failed command.
  await journalTrace
    .getStore()
    ?.begin()
    .catch(() => undefined)
}

export function journalChange(change: JournalChange): void {
  const trace = journalTrace.getStore()
  if (!trace) return
  trace.changeCount++
  if (trace.changes.length < 500) trace.changes.push(change)
}

export function journalPath(path: string): string {
  const trace = journalTrace.getStore()
  if (!trace) return path
  const offset = relative(trace.root, path)
  return offset.split(sep).join("/")
}

// Called by atomicWrite: only completed, changed files are facts. File contents,
// arbitrary config values, resource URLs and credentials never enter the journal.
export async function journalFileWrite(path: string, content: string): Promise<() => void> {
  const trace = journalTrace.getStore()
  if (!trace) return () => {}
  const offset = relative(trace.root, path)
  if (isAbsolute(offset) || offset === ".." || offset.startsWith(`..${sep}`)) return () => {}
  let previous: string | undefined
  let readable = true
  try {
    previous = await readFile(path, "utf8")
  } catch (error) {
    readable = (error as NodeJS.ErrnoException).code === "ENOENT"
  }
  if (previous === content) return () => {}
  await journalBeforeMutation()
  return () => {
    journalChange({
      kind: "file",
      target: journalPath(path),
      action: previous === undefined && readable ? "create" : "write",
      before: !readable
        ? { observed: false }
        : previous === undefined
          ? null
          : { digest: digest(previous) },
      after: { digest: digest(content) },
    })
    if (offset === "astrail.lock.yaml") recordLockChanges(previous, content)
  }
}

function recordLockChanges(before: string | undefined, after: string): void {
  try {
    const old = lockEntries(before)
    const next = lockEntries(after)
    for (const target of new Set([...Object.keys(old), ...Object.keys(next)])) {
      if (JSON.stringify(old[target]) === JSON.stringify(next[target])) continue
      journalChange({
        kind: "lock",
        target,
        action: "resolve",
        before: old[target] ?? null,
        after: next[target] ?? null,
      })
    }
  } catch {
    // A malformed lock still has a file digest; observing it cannot fail a write.
  }
}

function lockEntries(text: string | undefined): Record<string, JournalValues> {
  const document = text ? parse(text, { maxAliasCount: 50 }) : undefined
  const entries: Record<string, JournalValues> = {}
  for (const group of ["configs", "capabilities"]) {
    for (const [id, raw] of Object.entries(document?.[group] ?? {})) {
      if (!raw || typeof raw !== "object") continue
      const value = raw as Record<string, unknown>
      const safe: JournalValues = {}
      for (const key of ["identity", "version", "revision", "integrity", "resolvedCommit"]) {
        if (typeof value[key] === "string") safe[key] = value[key]
      }
      if (
        value.source &&
        typeof value.source === "object" &&
        "resolvedCommit" in value.source &&
        typeof value.source.resolvedCommit === "string"
      ) {
        safe.resolvedCommit = value.source.resolvedCommit
      }
      entries[`${group}/${id}`] = safe
    }
  }
  return entries
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}
