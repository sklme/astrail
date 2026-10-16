import { createInterface } from "node:readline/promises"
import type {
  DiscoveredSkillCandidate,
  SkillAdditionPlan,
  SkillAdditionRequest,
  SkillImportPlan,
  SkillImportRequest,
} from "astrail-core"

export interface SkillPrompter {
  collect(): Promise<SkillAdditionRequest>
  confirm(plan: SkillAdditionPlan): Promise<boolean>
}

export interface SkillImportPrompter {
  select(
    candidates: DiscoveredSkillCandidate[],
    options?: { allowSkip?: boolean },
  ): Promise<SkillImportRequest>
  confirm(plan: SkillImportPlan): Promise<boolean>
}

export function createTerminalSkillPrompter(): SkillPrompter {
  return {
    async collect() {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        const identity = await required(terminal, "Canonical Skill identity")
        const type = await choose(
          terminal,
          "Skill source (git/workspace/repository)",
          ["git", "workspace", "repository"],
          "git",
        )
        let source: SkillAdditionRequest["source"]
        if (type === "git") {
          const url = await required(terminal, "Git URL")
          const revisionKind = await choose(
            terminal,
            "Revision type (branch/tag/commit)",
            ["branch", "tag", "commit"],
            "tag",
          )
          source = {
            type,
            url,
            revision: { [revisionKind]: await required(terminal, `${revisionKind} value`) },
            path: await required(terminal, "Skill path inside repository"),
          }
        } else if (type === "workspace") {
          source = {
            type,
            path: await required(terminal, "Skill path inside Workspace"),
          }
        } else {
          source = {
            type,
            repository: await required(terminal, "Repository ID"),
            path: await required(terminal, "Skill path inside repository"),
          }
        }

        const id = (await terminal.question("Capability ID (leave blank to derive): ")).trim()
        const exposeAs = (await terminal.question("Skill alias (leave blank to derive): ")).trim()
        const version = (await terminal.question("Version (optional): ")).trim()
        const instructionsTrusted = await yesNo(
          terminal,
          "Trust instructions supplied by this Skill",
          false,
        )
        return {
          ...(id ? { id } : {}),
          identity,
          ...(version ? { version } : {}),
          ...(exposeAs ? { exposeAs } : {}),
          source,
          ...(instructionsTrusted ? { trust: { instructions: "trusted" } } : {}),
        }
      } finally {
        terminal.close()
      }
    },
    async confirm(plan) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await yesNo(terminal, `Apply plan ${plan.planId.slice(0, 12)}`, false)
      } finally {
        terminal.close()
      }
    },
  }
}

export function createTerminalSkillImportPrompter(): SkillImportPrompter {
  return {
    async select(candidates, options) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        const importable = candidates.filter((candidate) => candidate.importable)
        for (const [index, candidate] of importable.entries()) {
          const conflicts = candidate.conflicts.map((conflict) => conflict.field).join(",")
          process.stdout.write(
            `${index + 1}. ${candidate.repository}/${candidate.path} -> ${candidate.proposedIdentity} as ${candidate.proposedAlias}${conflicts ? ` (conflicts: ${conflicts})` : ""}\n`,
          )
        }
        const selected = await selectNumbers(terminal, importable.length, options?.allowSkip)
        const selections: SkillImportRequest["selections"] = []
        for (const index of selected) {
          const candidate = importable[index - 1]
          if (!candidate) continue
          const selection: SkillImportRequest["selections"][number] = {
            repository: candidate.repository,
            path: candidate.path,
          }
          for (const conflict of candidate.conflicts) {
            if (conflict.field === "identity") {
              selection.identity = await valueOrDefault(
                terminal,
                `Identity for ${candidate.name ?? candidate.path}`,
                candidate.proposedIdentity ?? "",
              )
            } else if (conflict.field === "id") {
              selection.id = await valueOrDefault(
                terminal,
                `Capability ID for ${candidate.name ?? candidate.path}`,
                candidate.proposedId ?? "",
              )
            } else {
              selection.exposeAs = await valueOrDefault(
                terminal,
                `Alias for ${candidate.name ?? candidate.path}`,
                candidate.proposedAlias ?? "",
              )
            }
          }
          if (
            !candidate.instructionsTrusted &&
            (await yesNo(
              terminal,
              `Trust instructions from ${candidate.repository}/${candidate.path}`,
              false,
            ))
          ) {
            selection.trust = { instructions: "trusted" }
          }
          selections.push(selection)
        }
        return { selections }
      } finally {
        terminal.close()
      }
    },
    async confirm(plan) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        return await yesNo(terminal, `Apply import plan ${plan.planId.slice(0, 12)}`, false)
      } finally {
        terminal.close()
      }
    },
  }
}

async function required(
  terminal: ReturnType<typeof createInterface>,
  label: string,
): Promise<string> {
  while (true) {
    const value = (await terminal.question(`${label}: `)).trim()
    if (value) return value
    process.stdout.write(`${label} is required.\n`)
  }
}

async function choose<T extends string>(
  terminal: ReturnType<typeof createInterface>,
  label: string,
  choices: readonly T[],
  defaultValue: T,
): Promise<T> {
  while (true) {
    const value = (await terminal.question(`${label} [${defaultValue}]: `)).trim() || defaultValue
    if (choices.includes(value as T)) return value as T
    process.stdout.write(`Choose one of: ${choices.join(", ")}\n`)
  }
}

async function yesNo(
  terminal: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? "Y/n" : "y/N"
  while (true) {
    const value = (await terminal.question(`${label}? [${suffix}]: `)).trim().toLowerCase()
    if (!value) return defaultValue
    if (value === "y" || value === "yes") return true
    if (value === "n" || value === "no") return false
    process.stdout.write("Answer yes or no.\n")
  }
}

async function selectNumbers(
  terminal: ReturnType<typeof createInterface>,
  maximum: number,
  allowSkip = false,
): Promise<number[]> {
  while (true) {
    const value = (
      await terminal.question(
        `Skill numbers to import (comma-separated${allowSkip ? "; leave blank to skip" : ""}): `,
      )
    ).trim()
    if (!value && allowSkip) return []
    const numbers = [
      ...new Set(
        value
          .split(",")
          .map((item) => Number.parseInt(item.trim(), 10))
          .filter((item) => Number.isInteger(item)),
      ),
    ]
    if (numbers.length > 0 && numbers.every((item) => item >= 1 && item <= maximum)) {
      return numbers
    }
    process.stdout.write(`Choose one or more numbers from 1 to ${maximum}.\n`)
  }
}

async function valueOrDefault(
  terminal: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
): Promise<string> {
  return (await terminal.question(`${label} [${defaultValue}]: `)).trim() || defaultValue
}
