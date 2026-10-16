import type { Diagnostic, Result, StructuredOutput } from "astrail-core"

export interface OutputWriter {
  out(value: string): void
  err(value: string): void
}

export const CLI_EXIT_CODES = {
  success: 0,
  invalid: 1,
  usage: 2,
  runtime: 3,
  refused: 4,
  interrupted: 130,
} as const

export const processWriter: OutputWriter = {
  out: (value) => process.stdout.write(value),
  err: (value) => process.stderr.write(value),
}

export function emitResult<T>(options: {
  command: string
  result: Result<T>
  json: boolean
  writer: OutputWriter
  startedAt: number
  workspaceRoot?: string
  human: (data: T) => string
}): void {
  if (options.json) {
    const envelope: StructuredOutput<T> = {
      schemaVersion: "1",
      command: options.command,
      success: options.result.success,
      data: options.result.data,
      diagnostics: options.result.diagnostics,
      meta: {
        ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
        durationMs: Date.now() - options.startedAt,
      },
    }
    options.writer.out(`${JSON.stringify(envelope, null, 2)}\n`)
  } else {
    const human = options.human(options.result.data)
    if (human) options.writer.out(human.endsWith("\n") ? human : `${human}\n`)
    renderDiagnostics(options.result.diagnostics, options.writer)
  }
  process.exitCode = options.result.success
    ? CLI_EXIT_CODES.success
    : options.result.diagnostics.some((item) =>
          [
            "ASTR5010",
            "ASTR5011",
            "ASTR6103",
            "ASTR6201",
            "ASTR7006",
            "ASTR7007",
            "ASTR7008",
            "ASTR7106",
            "ASTR7107",
            "ASTR7108",
            "ASTR7206",
            "ASTR7207",
            "ASTR7208",
            "ASTR7307",
            "ASTR7308",
            "ASTR7309",
            "ASTR8011",
            "ASTR8021",
            "ASTR8031",
            "ASTR8033",
          ].includes(item.code),
        )
      ? CLI_EXIT_CODES.refused
      : CLI_EXIT_CODES.invalid
}

export function renderDiagnostics(diagnostics: Diagnostic[], writer: OutputWriter): void {
  for (const item of diagnostics) {
    const location = item.location
      ? ` ${item.location.file}:${item.location.line}:${item.location.column}`
      : ""
    writer.err(`${item.severity.toUpperCase()} ${item.code}${location} ${item.message}\n`)
    if (item.remediation) writer.err(`  ${item.remediation}\n`)
  }
}

export function table(rows: object[], columns?: string[]): string {
  if (rows.length === 0) return "No entries."
  const keys = columns ?? Object.keys(rows[0] ?? {})
  const widths = keys.map((key) =>
    Math.max(key.length, ...rows.map((row) => printable(asRecord(row)[key]).length)),
  )
  const header = keys.map((key, index) => key.padEnd(widths[index] ?? key.length)).join("  ")
  const separator = widths.map((width) => "-".repeat(width)).join("  ")
  const body = rows.map((row) =>
    keys
      .map((key, index) => printable(asRecord(row)[key]).padEnd(widths[index] ?? key.length))
      .join("  "),
  )
  return [header, separator, ...body].join("\n")
}

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>
}

function printable(value: unknown): string {
  if (value === undefined) return "-"
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}
