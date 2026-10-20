import { randomUUID } from "node:crypto"
import { lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { type JournalDiagnostic, summarizeJournalDiagnostic } from "./journal-diagnostics.js"
import { summarizeJournalChanges } from "./journal-summary.js"
import {
  type JournalChange,
  type JournalStep,
  type JournalTargets,
  type JournalTrace,
  type JournalValues,
  journalTrace,
} from "./journal-trace.js"
import { parseYamlFile } from "./manifest.js"
import { runProcess } from "./process.js"
import { type Diagnostic, diagnostic, type Result, result } from "./types.js"

export const JOURNAL_DEFAULTS = { enabled: true, maxLines: 2_000, maxBytes: 4 * 1024 * 1024 }
const MAX_READ_BYTES = 64 * 1024 * 1024
const IGNORE_RULES = ["/journal.jsonl", "/journal.lock", "/.journal-*.tmp"]
export interface JournalSettings {
  enabled: boolean
  maxLines: number
  maxBytes: number
}
export interface JournalEvent extends JournalTargets {
  schemaVersion: "1"
  operationId: string
  command: string
  astrailVersion: string
  startedAt: string
  timestamp: string
  phase: "started" | "finished"
  status?: "success" | "failed" | "partial"
  durationMs?: number
  changes?: JournalChange[]
  omittedChanges?: number
  diagnosticCodes?: string[]
  diagnostics?: JournalDiagnostic[]
  omittedDiagnostics?: number
  steps?: JournalStep[]
  omittedSteps?: number
}
export interface JournalOperation extends Omit<JournalEvent, "phase" | "status"> {
  status: "success" | "failed" | "partial" | "unknown"
  summary?: string[]
}
export interface JournalQuery {
  limit?: number
  repo?: string
  environment?: string
  since?: string
}
export interface JournalListData {
  root: string
  path: string
  operations: JournalOperation[]
  retainedOperations: number
  incompleteHistory: true
}

export async function withWorkspaceJournal<T>(
  options: {
    root: string
    command: string
    version: string
    onWarning?: (warning: Diagnostic) => void
  },
  operation: () => Promise<Result<T>>,
): Promise<Result<T>> {
  // Composite operations share one trail and must never acquire a journal lock twice.
  if (journalTrace.getStore()) return operation()
  const root = resolve(options.root)
  const warnings: Diagnostic[] = []
  const warn = (item: Diagnostic) => {
    if (warnings.some((existing) => existing.code === item.code)) return
    warnings.push(item)
    options.onWarning?.(item)
  }
  const settings = await readSettings(root).catch(() => {
    warn(
      journalWarning(
        "ASTR7501",
        "Journal settings could not be read; recording is disabled for this operation.",
      ),
    )
    return { ...JOURNAL_DEFAULTS, enabled: false }
  })
  let started = false
  let starting: Promise<void> | undefined
  let unavailable = false
  const startedAt = new Date().toISOString()
  const operationId = randomUUID()
  const common = () => ({
    schemaVersion: "1" as const,
    operationId,
    command: options.command,
    astrailVersion: options.version,
    startedAt,
    ...trace.targets,
  })
  const append = async (event: JournalEvent) => {
    if (unavailable) return
    try {
      await appendEvent(root, event, settings)
    } catch {
      unavailable = true
      warn(
        journalWarning(
          "ASTR7502",
          "Journal could not be written; the operation result is unchanged and history may be incomplete.",
        ),
      )
    }
  }
  const trace: JournalTrace = {
    root,
    changes: [],
    changeCount: 0,
    targets: {},
    steps: [],
    stepCount: 0,
    async begin() {
      if (!settings.enabled) return
      starting ??= begin()
      await starting
    },
  }
  async function begin(): Promise<void> {
    started = true
    await append({ ...common(), phase: "started", timestamp: new Date().toISOString() })
    if (unavailable) return
    // Ignore rules do not remove an already tracked file from Git's index.
    const tracked = await runProcess("git", [
      "-C",
      root,
      "ls-files",
      "--error-unmatch",
      "--",
      ".astrail/journal.jsonl",
    ]).catch(() => undefined)
    if (tracked?.exitCode === 0)
      warn(
        journalWarning(
          "ASTR7503",
          "The journal is already tracked by Git; ignore rules do not prevent it from being committed.",
        ),
      )
  }
  const finish = async (success: boolean, diagnostics: Diagnostic[]) => {
    try {
      if (!settings.enabled || (success && trace.changeCount === 0 && !started)) return
      // init may fail before there is a destination workspace. Do not create it for a log.
      if (!started && !(await safeInfo(root))) return
      await trace.begin()
      await append({
        ...common(),
        phase: "finished",
        timestamp: new Date().toISOString(),
        status: success ? "success" : hasRemainingChanges(trace) ? "partial" : "failed",
        durationMs: Date.now() - Date.parse(startedAt),
        changes: trace.changes,
        omittedChanges: trace.changeCount - trace.changes.length,
        diagnosticCodes: [...new Set(diagnostics.map((item) => item.code))],
        diagnostics: diagnostics.slice(0, 100).map(summarizeJournalDiagnostic),
        omittedDiagnostics: Math.max(0, diagnostics.length - 100),
        steps: trace.steps,
        omittedSteps: trace.stepCount - trace.steps.length,
      })
    } catch {
      warn(
        journalWarning(
          "ASTR7502",
          "Journal could not be finalized; the operation result is unchanged and history may be incomplete.",
        ),
      )
    }
  }
  try {
    const outcome = settings.enabled ? await journalTrace.run(trace, operation) : await operation()
    await finish(outcome.success, outcome.diagnostics)
    return { ...outcome, diagnostics: [...outcome.diagnostics, ...warnings] }
  } catch (error) {
    await finish(false, [diagnostic("ASTR9001", "error", "Operation threw an exception")])
    throw error
  }
}

export async function listJournal(
  root: string,
  query: JournalQuery = {},
): Promise<Result<JournalListData>> {
  const data: JournalListData = {
    root,
    path: join(root, ".astrail", "journal.jsonl"),
    operations: [],
    retainedOperations: 0,
    incompleteHistory: true,
  }
  const limit = query.limit ?? 20
  const since = query.since === undefined ? undefined : parseJournalSince(query.since)
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100_000 ||
    (query.since !== undefined && since === undefined)
  ) {
    return result(data, [
      diagnostic(
        "ASTR7504",
        "error",
        "Use a limit from 1 to 100000 and an ISO date or timestamp with a timezone for --since.",
      ),
    ])
  }
  let read: { events: JournalEvent[]; skipped: number }
  try {
    await assertDestinations(root)
    read = await readEvents(data.path)
  } catch {
    return result(data, [
      diagnostic(
        "ASTR7505",
        "error",
        "Journal cannot be read: repair its path, permissions, or oversized file.",
      ),
    ])
  }
  const merged = new Map<string, JournalOperation>()
  for (const event of read.events) {
    const { phase, status, ...common } = event
    const previous = merged.get(event.operationId)
    if (phase === "started" && previous?.status !== undefined && previous.status !== "unknown")
      continue
    merged.delete(event.operationId)
    merged.set(event.operationId, {
      ...common,
      status: phase === "finished" ? (status ?? "unknown") : "unknown",
      summary: summarizeJournalChanges(common.changes ?? []),
    })
  }
  data.retainedOperations = merged.size
  data.operations = [...merged.values()]
    .reverse()
    .filter(
      (item) =>
        (!query.repo || item.repositories?.includes(query.repo)) &&
        (!query.environment || item.environments?.includes(query.environment)) &&
        (since === undefined || Date.parse(item.timestamp) >= since),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
  return result(
    data,
    read.skipped
      ? [
          journalWarning(
            "ASTR7506",
            `${read.skipped} malformed or unsupported journal events were skipped; history is incomplete.`,
          ),
        ]
      : [],
  )
}

export async function showJournal(
  root: string,
  operationId: string,
): Promise<Result<{ root: string; operation: JournalOperation | null }>> {
  const listed = await listJournal(root, { limit: 100_000 })
  const operation = listed.data.operations.find((item) => item.operationId === operationId) ?? null
  return result({ root, operation }, [
    ...listed.diagnostics,
    ...(listed.success && !operation
      ? [
          diagnostic(
            "ASTR7507",
            "error",
            "Operation not found in retained local history; it may have expired or been recorded elsewhere.",
          ),
        ]
      : []),
  ])
}

export function parseJournalSince(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
    return undefined
  const day = value.slice(0, 10)
  const timestamp = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
  const dayTime = Date.parse(`${day}T00:00:00Z`)
  return Number.isFinite(timestamp) &&
    Number.isFinite(dayTime) &&
    new Date(dayTime).toISOString().startsWith(day)
    ? timestamp
    : undefined
}

async function readSettings(root: string): Promise<JournalSettings> {
  const path = join(root, "astrail.local.yaml")
  if (!(await safeInfo(path))) return { ...JOURNAL_DEFAULTS }
  const parsed = await parseYamlFile(path)
  if (parsed.diagnostics.some((item) => item.severity === "error"))
    throw new Error("Invalid local YAML")
  const value = parsed.value.journal
  if (value === undefined) return { ...JOURNAL_DEFAULTS }
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !["enabled", "maxLines", "maxBytes"].includes(key))
  )
    throw new Error("Invalid journal settings")
  const settings = { ...JOURNAL_DEFAULTS, ...value }
  if (
    typeof settings.enabled !== "boolean" ||
    !Number.isSafeInteger(settings.maxLines) ||
    settings.maxLines < 2 ||
    settings.maxLines > 100_000 ||
    !Number.isSafeInteger(settings.maxBytes) ||
    settings.maxBytes < 4096 ||
    settings.maxBytes > MAX_READ_BYTES
  )
    throw new Error("Invalid journal bounds")
  return settings
}

async function appendEvent(
  root: string,
  event: JournalEvent,
  settings: JournalSettings,
): Promise<void> {
  // Raw filesystem writes intentionally bypass the mutation observer.
  await assertDestinations(root)
  const directory = join(root, ".astrail")
  await mkdir(directory, { recursive: true })
  await assertDestinations(root)
  const release = await lockJournal(directory)
  try {
    await assertDestinations(root)
    const ignorePath = join(directory, ".gitignore")
    const ignore = await readOptional(ignorePath)
    const rules = [...IGNORE_RULES, ...(ignore === undefined ? ["/.gitignore"] : [])]
    const missing = rules.filter((rule) => !ignore?.split(/\r?\n/).includes(rule))
    if (missing.length)
      await writeAtomic(
        ignorePath,
        `${ignore ?? ""}${ignore && !ignore.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`,
      )
    const path = join(directory, "journal.jsonl")
    const { events, skipped } = await readEvents(path)
    if (skipped)
      throw new Error("Preserve damaged or unsupported history until explicitly repaired")
    const safe = sanitizeEvent(event)
    // Keep an individual operation bounded as well as the overall file. Report
    // omitted details explicitly; truncation never changes the operation outcome.
    const budget = Math.min(64 * 1024, Math.floor(settings.maxBytes / 2))
    while (Buffer.byteLength(JSON.stringify(safe)) + 1 > budget) {
      // Share the detail budget so one large category does not erase all others.
      const largest = (
        [
          ["changes", "omittedChanges"],
          ["steps", "omittedSteps"],
          ["diagnostics", "omittedDiagnostics"],
        ] as const
      )
        .filter(([key]) => safe[key]?.length)
        .sort(([a], [b]) => JSON.stringify(safe[b]).length - JSON.stringify(safe[a]).length)[0]
      if (!largest) break
      safe[largest[0]]?.pop()
      safe[largest[1]] = (safe[largest[1]] ?? 0) + 1
    }
    if (Buffer.byteLength(JSON.stringify(safe)) + 1 > budget)
      throw new Error("Journal metadata exceeds event budget")
    const lines = [...events, safe].map((item) => `${JSON.stringify(item)}\n`)
    let bytes = 0
    let first = lines.length
    while (first > 0 && lines.length - first < settings.maxLines) {
      const next = Buffer.byteLength(lines[first - 1] ?? "")
      if (bytes + next > settings.maxBytes) break
      bytes += next
      first--
    }
    await writeAtomic(path, lines.slice(first).join(""))
  } finally {
    await release()
  }
}

async function lockJournal(directory: string): Promise<() => Promise<void>> {
  const path = join(directory, "journal.lock")
  const deadline = Date.now() + 1000
  while (true) {
    try {
      const handle = await open(path, "wx", 0o600)
      try {
        await handle.writeFile(String(process.pid))
      } finally {
        await handle.close()
      }
      return async () => {
        await rm(path, { force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const info = await safeInfo(path)
      if (info?.isSymbolicLink() || (info && !info.isFile())) throw new Error("Unsafe journal lock")
      // Never steal by age or PID: two reclaimers could unlink a new owner's
      // lock. An abandoned lock needs explicit repair; journal failure is advisory.
      if (Date.now() >= deadline) throw new Error("Journal busy")
      await delay(20)
    }
  }
}

async function assertDestinations(root: string): Promise<void> {
  const directory = join(root, ".astrail")
  const info = await safeInfo(directory)
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error("Unsafe journal directory")
  for (const name of ["journal.jsonl", "journal.lock", ".gitignore"]) {
    const child = await safeInfo(join(directory, name))
    if (child && (!child.isFile() || child.isSymbolicLink() || child.size > MAX_READ_BYTES))
      throw new Error("Unsafe journal file")
  }
}

async function readEvents(path: string): Promise<{ events: JournalEvent[]; skipped: number }> {
  const text = await readOptional(path)
  const events: JournalEvent[] = []
  let skipped = 0
  for (const line of text?.split("\n") ?? []) {
    if (!line.trim()) continue
    try {
      const value: unknown = JSON.parse(line)
      if (!validEvent(value)) {
        skipped++
        continue
      }
      events.push(sanitizeEvent(value))
    } catch {
      skipped++
    }
  }
  return { events, skipped }
}

function validEvent(value: unknown): value is JournalEvent {
  if (
    !isRecord(value) ||
    value.schemaVersion !== "1" ||
    !["started", "finished"].includes(String(value.phase))
  )
    return false
  for (const key of ["operationId", "command", "astrailVersion", "timestamp", "startedAt"])
    if (typeof value[key] !== "string") return false
  if (
    !Number.isFinite(Date.parse(String(value.timestamp))) ||
    !Number.isFinite(Date.parse(String(value.startedAt)))
  )
    return false
  if (
    value.phase === "finished" &&
    !["success", "failed", "partial"].includes(String(value.status))
  )
    return false
  for (const key of [
    "repositories",
    "environments",
    "skills",
    "diagnosticCodes",
    "pendingRepositories",
    "failedRepositories",
  ])
    if (
      value[key] !== undefined &&
      (!Array.isArray(value[key]) || !value[key].every((item: unknown) => typeof item === "string"))
    )
      return false
  if (value.planId !== undefined && typeof value.planId !== "string") return false
  for (const key of ["durationMs", "omittedChanges", "omittedSteps", "omittedDiagnostics"])
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0)
    )
      return false
  if (value.steps !== undefined && (!Array.isArray(value.steps) || !value.steps.every(validStep)))
    return false
  if (
    value.diagnostics !== undefined &&
    (!Array.isArray(value.diagnostics) || !value.diagnostics.every(validDiagnostic))
  )
    return false
  if (
    value.changes !== undefined &&
    (!Array.isArray(value.changes) ||
      !value.changes.every(
        (item: unknown) =>
          isRecord(item) &&
          ["file", "repository", "environment", "skill", "projection", "config", "lock"].includes(
            String(item.kind),
          ) &&
          typeof item.target === "string" &&
          typeof item.action === "string" &&
          [item.before, item.after].every(
            (state) =>
              state === undefined ||
              state === null ||
              (isRecord(state) &&
                Object.values(state).every(
                  (v) => v === null || ["string", "number", "boolean"].includes(typeof v),
                )),
          ),
      ))
  )
    return false
  return true
}

function sanitizeEvent(event: JournalEvent): JournalEvent {
  const safe: JournalEvent = {
    schemaVersion: "1",
    operationId: clean(event.operationId),
    command: clean(event.command),
    astrailVersion: clean(event.astrailVersion),
    startedAt: event.startedAt,
    timestamp: event.timestamp,
    phase: event.phase,
    ...(event.status ? { status: event.status } : {}),
    ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
    ...(event.planId ? { planId: clean(event.planId) } : {}),
    ...(event.omittedChanges !== undefined ? { omittedChanges: event.omittedChanges } : {}),
    ...(event.omittedSteps !== undefined ? { omittedSteps: event.omittedSteps } : {}),
    ...(event.omittedDiagnostics !== undefined
      ? { omittedDiagnostics: event.omittedDiagnostics }
      : {}),
  }
  for (const key of [
    "repositories",
    "environments",
    "skills",
    "diagnosticCodes",
    "pendingRepositories",
    "failedRepositories",
  ] as const)
    if (event[key]) safe[key] = event[key].map(clean)
  if (event.changes)
    safe.changes = event.changes.map((item) => ({
      kind: item.kind,
      target: clean(item.target),
      action: clean(item.action),
      ...(item.before !== undefined ? { before: cleanValues(item.before) } : {}),
      ...(item.after !== undefined ? { after: cleanValues(item.after) } : {}),
    }))
  if (event.steps)
    safe.steps = event.steps.map((step) => ({
      id: clean(step.id),
      ...(step.parentId ? { parentId: clean(step.parentId) } : {}),
      name: clean(step.name),
      ...(step.target ? { target: clean(step.target) } : {}),
      startedAt: step.startedAt,
      durationMs: step.durationMs,
      status: step.status,
      ...(step.reason ? { reason: step.reason } : {}),
      ...(step.diagnosticCodes ? { diagnosticCodes: step.diagnosticCodes.map(clean) } : {}),
    }))
  if (event.diagnostics)
    safe.diagnostics = event.diagnostics.map((item) => ({
      code: clean(item.code),
      severity: item.severity,
      message: clean(item.message),
      remediation: clean(item.remediation),
      messageSource: item.messageSource,
      ...(item.location
        ? {
            location: {
              file: clean(item.location.file),
              line: item.location.line,
              column: item.location.column,
              pointer: clean(item.location.pointer),
            },
          }
        : {}),
    }))
  return safe
}

function validStep(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.startedAt === "string" &&
    Number.isFinite(Date.parse(value.startedAt)) &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0 &&
    ["success", "failed", "skipped"].includes(String(value.status)) &&
    (value.parentId === undefined || typeof value.parentId === "string") &&
    (value.target === undefined || typeof value.target === "string") &&
    (value.reason === undefined ||
      ["no-actions", "blocked", "dry-run", "unchanged"].includes(String(value.reason))) &&
    (value.diagnosticCodes === undefined ||
      (Array.isArray(value.diagnosticCodes) &&
        value.diagnosticCodes.every((code: unknown) => typeof code === "string")))
  )
}

function validDiagnostic(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    typeof value.remediation !== "string" ||
    !["error", "warning", "information"].includes(String(value.severity)) ||
    !["catalog", "fallback"].includes(String(value.messageSource))
  )
    return false
  const location = value.location
  return (
    location === undefined ||
    (isRecord(location) &&
      typeof location.file === "string" &&
      typeof location.pointer === "string" &&
      typeof location.line === "number" &&
      Number.isSafeInteger(location.line) &&
      location.line >= 0 &&
      typeof location.column === "number" &&
      Number.isSafeInteger(location.column) &&
      location.column >= 0)
  )
}

function cleanValues(value: JournalValues | null): JournalValues | null {
  return value == null
    ? value
    : Object.fromEntries(
        Object.entries(value)
          .filter(
            ([key]) =>
              [
                "digest",
                "observed",
                "present",
                "isGitRepository",
                "branch",
                "revision",
                "identity",
                "version",
                "sourceType",
                "access",
                "required",
                "defaultBranch",
                "ownership",
                "integrity",
                "resolvedCommit",
                "installed",
                "manager",
              ].includes(key) || key.startsWith("branch:"),
          )
          .map(([key, item]) => [clean(key), typeof item === "string" ? clean(item) : item]),
      )
}

function hasRemainingChanges(trace: JournalTrace): boolean {
  if (trace.changeCount > trace.changes.length) return true
  const net = new Map<string, JournalChange>()
  for (const change of trace.changes) {
    const key = `${change.kind}:${change.target}`
    const first = net.get(key)
    net.set(
      key,
      first
        ? { ...change, ...(first.before !== undefined ? { before: first.before } : {}) }
        : change,
    )
  }
  return [...net.values()].some(
    (change) =>
      change.before === undefined ||
      change.after === undefined ||
      // Projection ownership/identity cannot prove content was restored. Keep
      // failures conservative unless both content snapshots are available.
      (change.kind === "projection" &&
        change.before !== null &&
        change.after !== null &&
        (!change.before.integrity || !change.after.integrity)) ||
      JSON.stringify(change.before) !== JSON.stringify(change.after),
  )
}

function clean(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip controls from untrusted history before terminal rendering.
  const printable = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
  return printable
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]+)/g,
      "[redacted]",
    )
    .replace(/((?:token|password|secret|authorization)[=:])\S+/gi, "$1[redacted]")
    .slice(0, 512)
}

function journalWarning(code: string, message: string): Diagnostic {
  return diagnostic(code, "warning", message, {
    remediation:
      "Inspect .astrail/journal.jsonl and local journal settings. Current state remains available through status and doctor.",
  })
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
async function safeInfo(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}
async function readOptional(path: string) {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}
async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = join(resolve(path, ".."), `.journal-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
