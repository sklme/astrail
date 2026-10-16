import { dirname, resolve } from "node:path"
import {
  type Diagnostic,
  discoverWorkspaceRoot,
  type JournalListData,
  type JournalOperation,
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
    operation,
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
    ...(operation.planId ? [`Plan: ${operation.planId}`] : []),
    summarizeJournal(operation),
    table(
      (operation.changes ?? []).map((change) => ({
        kind: change.kind,
        target: change.target,
        action: change.action,
        before: change.before,
        after: change.after,
      })),
    ),
    ...(operation.diagnosticCodes?.length
      ? [`Diagnostics: ${operation.diagnosticCodes.join(", ")}`]
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
  ].join("\n")
}

function summarizeJournal(operation: JournalOperation): string {
  if (operation.status === "unknown") return "Result unconfirmed; verify with status/doctor"
  const changes = operation.changes ?? []
  const checkouts = changes.filter((change) => change.action === "checkout")
  if (checkouts.length)
    return checkouts
      .map(
        (change) =>
          `${change.target}: ${change.before?.branch ?? "detached"} → ${change.after?.branch ?? "detached"}`,
      )
      .join("; ")
  const count = changes.length + (operation.omittedChanges ?? 0)
  return `${count} recorded changes${operation.diagnosticCodes?.length ? `; ${operation.diagnosticCodes.join(", ")}` : ""}`
}
