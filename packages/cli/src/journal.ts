import { dirname, resolve } from "node:path"
import {
  type Diagnostic,
  discoverWorkspaceRoot,
  type JournalListData,
  type JournalOperation,
  journalStep,
  type Result,
  withWorkspaceJournal,
} from "astrail-core"
import { table } from "./output.js"

const MUTATIONS = new Set([
  "init",
  "repo add",
  "env add",
  "env checkout",
  "skill add",
  "skill import",
  "install",
  "bootstrap",
  "sync",
  "editor sync",
  "open",
  "lock",
  "update",
])

export async function executeWithJournal<T>(
  name: string,
  context: { cwd?: string; config?: string },
  options: { dryRun?: boolean; restore?: boolean },
  version: string,
  operation: () => Promise<Result<T>>,
  onWarning: (warning: Diagnostic) => void,
): Promise<Result<T>> {
  if (options.dryRun || !MUTATIONS.has(name)) return operation()
  const root =
    name === "init"
      ? dirname(resolve(context.cwd ?? process.cwd(), context.config ?? "astrail.yaml"))
      : (await discoverWorkspaceRoot(context.cwd, context.config)).root
  return withWorkspaceJournal(
    {
      root,
      command: name === "update" && options.restore ? "update.restore" : name.replaceAll(" ", "."),
      version,
      onWarning,
    },
    () => journalStep(name.replaceAll(" ", "."), operation),
  )
}

export function renderJournal(data: JournalListData): string {
  if (data.operations.length === 0) return "No matching operations in retained local history."
  return table(
    data.operations.map((operation) => ({
      time: operation.timestamp,
      operation: operation.command,
      target:
        [
          ...(operation.repositories ?? []),
          ...(operation.environments ?? []),
          ...(operation.skills ?? []),
        ].join(", ") || "workspace",
      status: operation.status,
      duration: duration(operation.durationMs),
      summary: summarizeJournal(operation),
      id: operation.operationId,
    })),
  )
}

export function renderJournalOperation(data: { operation: JournalOperation | null }): string {
  const operation = data.operation
  if (!operation) return ""
  return [
    `${operation.command}  ${operation.operationId}  ${operation.status}`,
    `Started: ${operation.startedAt}`,
    `Last event: ${operation.timestamp}`,
    `Astrail: ${operation.astrailVersion}`,
    `Duration: ${duration(operation.durationMs)}`,
    ...(operation.planId ? [`Plan: ${operation.planId}`] : []),
    summarizeJournal(operation),
    ...(operation.summary ?? []).map((line) => `- ${line}`),
    ...(operation.steps?.length
      ? [
          "Steps (parent durations include child steps):",
          table(
            operation.steps.map((step) => ({
              id: step.id,
              parent: step.parentId,
              step: step.name,
              target: step.target,
              status: step.status,
              duration: duration(step.durationMs),
              reason: step.reason,
              diagnostics: step.diagnosticCodes?.join(", "),
            })),
          ),
        ]
      : []),
    "Recorded changes:",
    table(
      (operation.changes ?? []).map((change) => ({
        kind: change.kind,
        target: change.target,
        action: change.action,
        before: change.before,
        after: change.after,
      })),
    ),
    ...(operation.diagnostics?.length
      ? [
          "Diagnostics:",
          ...operation.diagnostics.map((item) =>
            [
              `${item.severity.toUpperCase()} ${item.code}: ${item.message}`,
              ...(item.location
                ? [
                    `  ${item.location.file}:${item.location.line}:${item.location.column} ${item.location.pointer}`,
                  ]
                : []),
              `  ${item.remediation}`,
            ].join("\n"),
          ),
        ]
      : []),
    ...(operation.diagnosticCodes?.filter(
      (code) => !operation.diagnostics?.some((item) => item.code === code),
    ).length
      ? [
          `Diagnostic codes (details not retained): ${operation.diagnosticCodes.filter((code) => !operation.diagnostics?.some((item) => item.code === code)).join(", ")}`,
        ]
      : []),
    ...(operation.failedRepositories?.length
      ? [`Failed repositories: ${operation.failedRepositories.join(", ")}`]
      : []),
    ...(operation.pendingRepositories?.length
      ? [`Pending repositories: ${operation.pendingRepositories.join(", ")}`]
      : []),
    ...(operation.omittedChanges
      ? [`${operation.omittedChanges} change details omitted by the retention budget.`]
      : []),
    ...(operation.omittedSteps
      ? [`${operation.omittedSteps} step details omitted by the retention budget.`]
      : []),
    ...(operation.omittedDiagnostics
      ? [`${operation.omittedDiagnostics} diagnostic details omitted by the retention budget.`]
      : []),
  ].join("\n")
}

function summarizeJournal(operation: JournalOperation): string {
  if (operation.status === "unknown") return "Result unconfirmed; verify with status/doctor"
  const lines = operation.summary ?? []
  const visible = lines.slice(0, 3).join("; ") || "No recorded changes"
  return `${visible}${lines.length > 3 ? `; +${lines.length - 3} more` : ""}${operation.omittedChanges ? `; ${operation.omittedChanges} changes omitted` : ""}${operation.diagnosticCodes?.length ? `; ${operation.diagnosticCodes.join(", ")}` : ""}`
}

function duration(milliseconds: number | undefined): string {
  if (milliseconds === undefined) return "-"
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(2)} s`
}
