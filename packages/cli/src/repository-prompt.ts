import { createInterface } from "node:readline/promises"
import type { RepositoryAdditionPlan, RepositoryAdditionRequest } from "astrail-core"

export interface RepositoryPrompter {
  collect(): Promise<RepositoryAdditionRequest>
  confirm(plan: RepositoryAdditionPlan): Promise<boolean>
}

export interface RepositoryPromptIO {
  question(prompt: string): Promise<string>
  write(message: string): void
}

export function createTerminalRepositoryPrompter(): RepositoryPrompter {
  return {
    async collect() {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await collectRepositoryRequest(promptIO(terminal))
      } finally {
        terminal.close()
      }
    },
    async confirm(plan) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await yesNo(promptIO(terminal), `Apply plan ${plan.planId.slice(0, 12)}`, false)
      } finally {
        terminal.close()
      }
    },
  }
}

export async function collectRepositoryRequest(
  terminal: RepositoryPromptIO,
): Promise<RepositoryAdditionRequest> {
  const type = await choose(
    terminal,
    "Repository source (git/local/subpath)",
    ["git", "local", "subpath"],
    "git",
  )
  let source: RepositoryAdditionRequest["source"]
  if (type === "git") {
    const url = await required(terminal, "Git URL")
    const revisionKind = await choose(
      terminal,
      "Revision type (none/branch/tag/commit)",
      ["none", "branch", "tag", "commit"],
      "none",
    )
    const revision =
      revisionKind === "none"
        ? undefined
        : { [revisionKind]: await required(terminal, `${revisionKind} value`) }
    source = { type, url, ...(revision ? { revision } : {}) }
  } else if (type === "local") {
    source = { type, path: await required(terminal, "Local directory path") }
  } else {
    source = {
      type,
      repository: await required(terminal, "Parent repository ID"),
      path: await required(terminal, "Path inside parent repository"),
    }
  }

  const id = (await terminal.question("Repository ID (leave blank to derive): ")).trim()
  const description = await required(terminal, "Repository description (what this repository owns)")
  const accessValue = await choose(
    terminal,
    "Access (default/read-only/read-write)",
    ["default", "read-only", "read-write"],
    "default",
  )
  const requiredValue = await yesNo(terminal, "Required repository", true)
  const instructionsTrusted = await yesNo(
    terminal,
    "Trust instructions supplied by this repository",
    false,
  )
  const writeTarget = await choose(
    terminal,
    "Manifest target (auto/shared/local)",
    ["auto", "shared", "local"],
    "auto",
  )
  return {
    ...(id ? { id } : {}),
    source,
    description,
    ...(accessValue === "default" ? {} : { access: accessValue }),
    required: requiredValue,
    ...(instructionsTrusted ? { trust: { instructions: "trusted" } } : {}),
    writeTarget,
  }
}

function promptIO(terminal: ReturnType<typeof createInterface>): RepositoryPromptIO {
  return {
    question: (prompt) => terminal.question(prompt),
    write: (message) => process.stdout.write(message),
  }
}

async function required(terminal: RepositoryPromptIO, label: string): Promise<string> {
  while (true) {
    const value = (await terminal.question(`${label}: `)).trim()
    if (value) return value
    terminal.write(`${label} is required.\n`)
  }
}

async function choose<T extends string>(
  terminal: RepositoryPromptIO,
  label: string,
  choices: readonly T[],
  defaultValue: T,
): Promise<T> {
  while (true) {
    const value = (await terminal.question(`${label} [${defaultValue}]: `)).trim() || defaultValue
    if (choices.includes(value as T)) return value as T
    terminal.write(`Choose one of: ${choices.join(", ")}\n`)
  }
}

async function yesNo(
  terminal: RepositoryPromptIO,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N"
  while (true) {
    const value = (await terminal.question(`${label}? [${suffix}]: `)).trim().toLowerCase()
    if (!value) return defaultValue
    if (value === "y" || value === "yes") return true
    if (value === "n" || value === "no") return false
    terminal.write("Answer yes or no.\n")
  }
}
