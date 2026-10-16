import { createHash } from "node:crypto"
import type { Environment } from "astrail-schema"
import { parseDocument } from "yaml"
import { validateEnvironmentBranches } from "./environment-branches.js"
import { acquireOperationLock, atomicWrite, readTextIfExists } from "./fs.js"
import { journalChange, journalTargets } from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import { resolveWorkspace } from "./resolver.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedEnvironment,
  type Result,
  result,
} from "./types.js"

export interface EnvironmentAdditionRequest {
  id: string
  repositories: string[]
  branch?: string
  branches?: Record<string, string>
  description?: string
  provider?: string
  resources?: Record<string, string | number | boolean | { provider: string; key: string }>
}

export interface NormalizedEnvironmentAddition {
  id: string
  environment: Environment
}

export interface EnvironmentFileChange {
  path: string
  kind: "update"
  beforeDigest: string
  afterDigest: string
  environmentValue: Record<string, unknown>
}

export interface EnvironmentAdditionPlan {
  operation: "environment-add"
  planId: string
  root: string
  configPath: string
  addition: NormalizedEnvironmentAddition | null
  files: EnvironmentFileChange[]
  actions: Array<{
    id: string
    type: "write"
    target: string
    description: string
    requiresAuthorization: true
  }>
  diagnostics: Diagnostic[]
}

export interface EnvironmentAdditionApplyData {
  applied: boolean
  plan: EnvironmentAdditionPlan
  environment?: ResolvedEnvironment
}

export interface EnvironmentAdditionApplyOptions {
  authorized?: boolean
  expectedPlanId?: string
}

export async function planEnvironmentAddition(
  input: unknown,
  options: { cwd?: string; config?: string } = {},
): Promise<EnvironmentAdditionPlan> {
  const loaded = await loadWorkspace(options)
  const workspace = await resolveWorkspace(options)
  const diagnostics = uniqueDiagnostics([...loaded.diagnostics, ...workspace.diagnostics])
  const addition = normalizeEnvironmentAddition(input, workspace.config, diagnostics)
  const files: EnvironmentFileChange[] = []

  if (addition && workspace.config.environments?.[addition.id]) {
    diagnostics.push(
      diagnostic("ASTR7202", "error", `Environment ${addition.id} already exists`, {
        remediation:
          "Choose a different environment ID. Updating environments is a separate operation.",
      }),
    )
  }

  if (addition && !hasErrors(diagnostics)) {
    const current = await readTextIfExists(loaded.configPath)
    if (current === undefined) {
      diagnostics.push(
        diagnostic(
          "ASTR7205",
          "error",
          `Environment target manifest is missing: ${loaded.configPath}`,
        ),
      )
    } else {
      try {
        const environmentValue = addition.environment as unknown as Record<string, unknown>
        const next = renderEnvironmentEdit(current, addition.id, environmentValue)
        files.push({
          path: loaded.configPath,
          kind: "update",
          beforeDigest: hash(current),
          afterDigest: hash(next),
          environmentValue,
        })
      } catch (error) {
        diagnostics.push(
          diagnostic(
            "ASTR7205",
            "error",
            `Cannot edit ${loaded.configPath}: ${error instanceof Error ? error.message : String(error)}`,
            { remediation: "Repair the YAML file before adding an environment." },
          ),
        )
      }
    }
  }

  const planId = hash(
    stableStringify({
      root: loaded.root,
      addition,
      files: files.map(({ path, beforeDigest, afterDigest, environmentValue }) => ({
        path,
        beforeDigest,
        afterDigest,
        environmentValue,
      })),
    }),
  )
  journalTargets({
    environments: addition ? [addition.id] : [],
    repositories: addition?.environment.repositories ?? [],
    planId,
  })
  return {
    operation: "environment-add",
    planId,
    root: loaded.root,
    configPath: loaded.configPath,
    addition,
    files,
    actions: files.map((file) => ({
      id: `write:shared:${addition?.id ?? "environment"}`,
      type: "write",
      target: file.path,
      description: `Update shared manifest for environment ${addition?.id ?? ""}`.trim(),
      requiresAuthorization: true,
    })),
    diagnostics,
  }
}

export async function applyEnvironmentAddition(
  plan: EnvironmentAdditionPlan,
  options: EnvironmentAdditionApplyOptions = {},
): Promise<Result<EnvironmentAdditionApplyData>> {
  journalTargets({
    environments: plan.addition ? [plan.addition.id] : [],
    repositories: plan.addition?.environment.repositories ?? [],
    planId: plan.planId,
  })
  const diagnostics = [...plan.diagnostics]
  const data: EnvironmentAdditionApplyData = { applied: false, plan }
  if (hasErrors(diagnostics) || !plan.addition) return result(data, diagnostics)
  if (!options.authorized) {
    diagnostics.push(
      diagnostic("ASTR7206", "error", "Adding an environment requires explicit authorization", {
        remediation: "Review the plan, then authorize that exact plan.",
      }),
    )
    return result(data, diagnostics)
  }
  if (options.expectedPlanId !== undefined && options.expectedPlanId !== plan.planId) {
    diagnostics.push(
      diagnostic("ASTR7207", "error", "Environment plan does not match the reviewed plan", {
        remediation: "Run a new dry-run, review it, and authorize its planId.",
        details: { expected: options.expectedPlanId, actual: plan.planId },
      }),
    )
    return result(data, diagnostics)
  }

  const lock = await acquireOperationLock(plan.root)
  const originals = new Map<string, string>()
  let writesStarted = false
  try {
    for (const file of plan.files) {
      const current = await readTextIfExists(file.path)
      if (current === undefined || hash(current) !== file.beforeDigest) {
        diagnostics.push(
          diagnostic("ASTR7208", "error", `Environment plan is stale for ${file.path}`, {
            remediation: "Run a new dry-run and review the updated plan.",
            details: {
              expected: file.beforeDigest,
              actual: current === undefined ? "<missing>" : hash(current),
            },
          }),
        )
        continue
      }
      originals.set(file.path, current)
    }
    if (hasErrors(diagnostics)) return result(data, diagnostics)

    for (const file of plan.files) {
      const current = originals.get(file.path)
      if (current === undefined) return result(data, diagnostics)
      const content = renderEnvironmentEdit(current, plan.addition.id, file.environmentValue)
      if (hash(content) !== file.afterDigest) {
        diagnostics.push(
          diagnostic("ASTR7209", "error", `Environment plan rendering changed for ${file.path}`, {
            remediation: "Run a new dry-run with the current Astrail version.",
          }),
        )
        return result(data, diagnostics)
      }
      writesStarted = true
      await atomicWrite(file.path, content)
    }

    const verified = await resolveWorkspace({ cwd: plan.root, config: plan.configPath })
    const verificationErrors = verified.diagnostics.filter((item) => item.severity === "error")
    const environment = verified.topology.environments.find((item) => item.id === plan.addition?.id)
    if (
      verificationErrors.length > 0 ||
      !environment ||
      stableStringify(environment.checkout) !== stableStringify(plan.addition.environment.checkout)
    ) {
      diagnostics.push(
        ...verificationErrors,
        diagnostic("ASTR7210", "error", "Environment addition failed composed verification", {
          remediation: "The original manifest was restored.",
        }),
      )
      diagnostics.push(...(await restoreFiles(originals)))
      return result(data, uniqueDiagnostics(diagnostics))
    }
    journalChange({
      kind: "environment",
      target: environment.id,
      action: "declare",
      before: null,
      after: {
        defaultBranch: environment.checkout?.branch ?? null,
        ...Object.fromEntries(
          Object.entries(environment.checkout?.branches ?? {}).map(([id, branch]) => [
            `branch:${id}`,
            branch,
          ]),
        ),
      },
    })
    return result(
      { applied: true, plan, environment },
      uniqueDiagnostics([...diagnostics, ...verified.diagnostics]),
    )
  } catch (error) {
    if (writesStarted) diagnostics.push(...(await restoreFiles(originals)))
    diagnostics.push(
      diagnostic(
        "ASTR7211",
        "error",
        `Failed to apply environment plan: ${error instanceof Error ? error.message : String(error)}`,
        { remediation: "The original manifest was restored when possible." },
      ),
    )
    return result(data, uniqueDiagnostics(diagnostics))
  } finally {
    await lock.release()
  }
}

function normalizeEnvironmentAddition(
  input: unknown,
  workspace: {
    repositories?: Record<string, { disabled?: boolean }>
    environments?: Record<string, unknown>
  },
  diagnostics: Diagnostic[],
): NormalizedEnvironmentAddition | null {
  if (!isRecord(input)) {
    diagnostics.push(diagnostic("ASTR7201", "error", "Environment input must be a JSON object"))
    return null
  }
  validateKnownFields(
    input,
    ["id", "repositories", "branch", "branches", "description", "provider", "resources"],
    diagnostics,
  )
  const id = optionalString(input.id, "id", diagnostics)
  const branch = optionalString(input.branch, "branch", diagnostics)
  if (!id || !validIdentifier(id)) {
    diagnostics.push(diagnostic("ASTR7201", "error", `Invalid environment ID ${id ?? "<missing>"}`))
  }
  const repositories = normalizeRepositories(
    input.repositories,
    workspace.repositories ?? {},
    diagnostics,
  )
  const branches = normalizeBranches(input.branches, diagnostics)
  const checkout = { ...(branch ? { branch } : {}), ...(branches ? { branches } : {}) }
  diagnostics.push(...validateEnvironmentBranches(id ?? "<missing>", repositories, checkout))
  const description = optionalString(input.description, "description", diagnostics)
  const provider = optionalString(input.provider, "provider", diagnostics)
  if (provider && !validIdentifier(provider)) {
    diagnostics.push(diagnostic("ASTR7201", "error", `Invalid environment provider ${provider}`))
  }
  const resources = normalizeResources(input.resources, diagnostics)
  if (!id || !validIdentifier(id) || repositories.length === 0 || hasErrors(diagnostics))
    return null

  return {
    id,
    environment: {
      ...(description ? { description } : {}),
      repositories: repositories as [string, ...string[]],
      checkout,
      ...(provider ? { provider } : {}),
      ...(resources ? { resources } : {}),
    },
  }
}

function normalizeBranches(
  value: unknown,
  diagnostics: Diagnostic[],
): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || Object.keys(value).length === 0) {
    diagnostics.push(
      diagnostic("ASTR7201", "error", "Environment branches must be a non-empty object"),
    )
    return undefined
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([repository, branch]) => {
        if (!validIdentifier(repository) || typeof branch !== "string" || !branch.trim()) {
          diagnostics.push(
            diagnostic("ASTR7201", "error", `Invalid branch override for repository ${repository}`),
          )
          return []
        }
        return [[repository, branch.trim()]]
      }),
  )
}

function normalizeRepositories(
  value: unknown,
  definitions: Record<string, { disabled?: boolean }>,
  diagnostics: Diagnostic[],
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(
      diagnostic("ASTR7201", "error", "Environment repositories must be a non-empty array"),
    )
    return []
  }
  const repositories = value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : [],
  )
  if (repositories.length !== value.length) {
    diagnostics.push(
      diagnostic("ASTR7201", "error", "Environment repository IDs must be non-empty strings"),
    )
  }
  if (new Set(repositories).size !== repositories.length) {
    diagnostics.push(diagnostic("ASTR7201", "error", "Environment repositories must be unique"))
  }
  for (const repository of repositories) {
    if (!definitions[repository] || definitions[repository]?.disabled === true) {
      diagnostics.push(
        diagnostic("ASTR2021", "error", `Environment references unknown repository ${repository}`),
      )
    }
  }
  return [...new Set(repositories)].sort()
}

function normalizeResources(
  value: unknown,
  diagnostics: Diagnostic[],
): EnvironmentAdditionRequest["resources"] | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("ASTR7201", "error", "Environment resources must be an object"))
    return undefined
  }
  const resources: NonNullable<EnvironmentAdditionRequest["resources"]> = {}
  for (const [key, item] of Object.entries(value)) {
    if (["string", "number", "boolean"].includes(typeof item)) {
      resources[key] = item as string | number | boolean
      continue
    }
    if (
      isRecord(item) &&
      Object.keys(item).every((field) => field === "provider" || field === "key") &&
      typeof item.provider === "string" &&
      item.provider.trim() &&
      typeof item.key === "string" &&
      item.key.trim()
    ) {
      resources[key] = { provider: item.provider.trim(), key: item.key.trim() }
      continue
    }
    diagnostics.push(
      diagnostic("ASTR7201", "error", `Invalid environment resource ${key}`, {
        remediation: "Use a string, number, boolean, or { provider, key } secret reference.",
      }),
    )
  }
  return resources
}

function renderEnvironmentEdit(
  current: string,
  id: string,
  environmentValue: Record<string, unknown>,
): string {
  const document = parseDocument(current, { strict: true, uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "Invalid YAML")
  document.setIn(["environments", id], environmentValue)
  return document.toString({ lineWidth: 0 })
}

async function restoreFiles(originals: Map<string, string>): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  for (const [path, content] of originals) {
    try {
      await atomicWrite(path, content)
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR7212",
          "error",
          `Failed to restore ${path}: ${error instanceof Error ? error.message : String(error)}`,
          { remediation: "Restore this manifest from version control or backup before retrying." },
        ),
      )
    }
  }
  return diagnostics
}

function optionalString(
  value: unknown,
  name: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    diagnostics.push(diagnostic("ASTR7201", "error", `Environment ${name} must be a string`))
    return undefined
  }
  return value.trim() || undefined
}

function validateKnownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    diagnostics.push(
      diagnostic("ASTR7201", "error", `Unknown environment input field ${key}`, {
        remediation: "Remove the field or use a supported environment authoring property.",
      }),
    )
  }
}

function validIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(value)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error")
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
