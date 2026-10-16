import { createInterface } from "node:readline/promises"
import type { EnvironmentAdditionPlan, EnvironmentAdditionRequest } from "astrail-core"

export interface EnvironmentPrompter {
  collect(): Promise<EnvironmentAdditionRequest>
  confirm(plan: EnvironmentAdditionPlan): Promise<boolean>
}

export function createTerminalEnvironmentPrompter(): EnvironmentPrompter {
  return {
    async collect() {
      const terminal = createInterface({ input: process.stdin, output: process.stdout })
      try {
        const id = await required(terminal, "Environment ID")
        const repositories = await repositoryList(terminal)
        const branch = (
          await terminal.question(
            "Default branch (optional when every repository has its own branch): ",
          )
        ).trim()
        const branches: Record<string, string> = {}
        if (
          !branch ||
          (await yesNo(terminal, "Override branches for individual repositories", false))
        ) {
          for (const repository of repositories) {
            const value = branch
              ? (await terminal.question(`Branch for ${repository} (Enter for ${branch}): `)).trim()
              : await required(terminal, `Branch for ${repository}`)
            if (value) Object.defineProperty(branches, repository, { value, enumerable: true })
          }
        }
        const description = (await terminal.question("Description (optional): ")).trim()
        const provider = (await terminal.question("Provider (optional): ")).trim()
        const resources = await optionalResources(terminal)
        return {
          id,
          repositories,
          ...(branch ? { branch } : {}),
          ...(Object.keys(branches).length > 0 ? { branches } : {}),
          ...(description ? { description } : {}),
          ...(provider ? { provider } : {}),
          ...(resources ? { resources } : {}),
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

async function repositoryList(terminal: ReturnType<typeof createInterface>): Promise<string[]> {
  while (true) {
    const value = await required(terminal, "Repository IDs (comma-separated)")
    const repositories = [
      ...new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ]
    if (repositories.length > 0) return repositories
    process.stdout.write("At least one repository ID is required.\n")
  }
}

async function optionalResources(
  terminal: ReturnType<typeof createInterface>,
): Promise<EnvironmentAdditionRequest["resources"] | undefined> {
  while (true) {
    const value = (await terminal.question("Resources JSON (optional): ")).trim()
    if (!value) return undefined
    try {
      const parsed = JSON.parse(value)
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as EnvironmentAdditionRequest["resources"]
      }
    } catch {
      // The next line presents one stable correction prompt.
    }
    process.stdout.write("Resources must be a JSON object.\n")
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
