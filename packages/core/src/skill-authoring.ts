import { createHash } from "node:crypto"
import { isAbsolute, normalize, sep } from "node:path"
import type { Capability } from "astrail-schema"
import { parseDocument } from "yaml"
import { configBindingSnapshot } from "./config-inputs.js"
import { acquireOperationLock, atomicWrite, readTextIfExists } from "./fs.js"
import { journalChange, journalTargets } from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import { resolveWorkspace } from "./resolver.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedCapability,
  type Result,
  result,
} from "./types.js"

export type SkillAdditionSource =
  | {
      type: "git"
      url: string
      revision: { branch?: string; tag?: string; commit?: string }
      path: string
    }
  | { type: "workspace"; path: string }
  | { type: "repository"; repository: string; path: string }

export interface SkillAdditionRequest {
  id?: string
  identity: string
  version?: string
  exposeAs?: string
  description?: string
  source: SkillAdditionSource
  trust?: { instructions?: "trusted" | "disabled" }
}

export interface NormalizedSkillAddition {
  id: string
  capability: Capability
}

export interface SkillFileChange {
  path: string
  kind: "update"
  beforeDigest: string
  afterDigest: string
  capabilityValue: Record<string, unknown>
}

export interface SkillAdditionPlan {
  inputBindings?: string
  operation: "skill-add"
  planId: string
  root: string
  configPath: string
  addition: NormalizedSkillAddition | null
  files: SkillFileChange[]
  actions: Array<{
    id: string
    type: "write"
    target: string
    description: string
    requiresAuthorization: true
  }>
  diagnostics: Diagnostic[]
}

export interface SkillAdditionApplyData {
  applied: boolean
  plan: SkillAdditionPlan
  capability?: ResolvedCapability
}

export interface SkillAdditionApplyOptions {
  authorized?: boolean
  expectedPlanId?: string
}

export async function planSkillAddition(
  input: unknown,
  options: { cwd?: string; config?: string } = {},
): Promise<SkillAdditionPlan> {
  const loaded = await loadWorkspace(options)
  const workspace = await resolveWorkspace(options)
  const diagnostics = uniqueDiagnostics([...loaded.diagnostics, ...workspace.diagnostics])
  const addition = normalizeSkillAddition(input, workspace.config.capabilities ?? {}, diagnostics)
  const files: SkillFileChange[] = []

  if (addition) {
    validateSkillAddition(
      addition,
      workspace.config.capabilities ?? {},
      workspace.config.repositories ?? {},
      diagnostics,
    )
  }

  if (addition && !hasErrors(diagnostics)) {
    const current = await readTextIfExists(loaded.configPath)
    try {
      if (current === undefined) throw new Error(`Manifest is unavailable: ${loaded.configPath}`)
      const capabilityValue = addition.capability as unknown as Record<string, unknown>
      const next = renderSkillEdit(current, addition.id, capabilityValue)
      files.push({
        path: loaded.configPath,
        kind: "update",
        beforeDigest: hashOptional(current),
        afterDigest: hash(next),
        capabilityValue,
      })
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR7105",
          "error",
          `Cannot edit ${loaded.configPath}: ${error instanceof Error ? error.message : String(error)}`,
          { remediation: "Repair the YAML file before adding a Skill." },
        ),
      )
    }
  }

  const planId = hash(
    stableStringify({
      root: loaded.root,
      inputBindings: configBindingSnapshot(loaded.configs),
      addition,
      files: files.map(({ path, beforeDigest, afterDigest, capabilityValue }) => ({
        path,
        beforeDigest,
        afterDigest,
        capabilityValue,
      })),
    }),
  )
  journalTargets({
    skills: addition ? [addition.id] : [],
    repositories:
      addition?.capability.source?.type === "repository" && addition.capability.source.repository
        ? [addition.capability.source.repository]
        : [],
    planId,
  })
  return {
    operation: "skill-add",
    planId,
    root: loaded.root,
    configPath: loaded.configPath,
    inputBindings: configBindingSnapshot(loaded.configs),
    addition,
    files,
    actions: files.map((file) => ({
      id: `write:shared:${addition?.id ?? "skill"}`,
      type: "write",
      target: file.path,
      description: `Update shared manifest for Skill ${addition?.id ?? ""}`.trim(),
      requiresAuthorization: true,
    })),
    diagnostics,
  }
}

export async function applySkillAddition(
  plan: SkillAdditionPlan,
  options: SkillAdditionApplyOptions = {},
): Promise<Result<SkillAdditionApplyData>> {
  journalTargets({ skills: plan.addition ? [plan.addition.id] : [], planId: plan.planId })
  const diagnostics = [...plan.diagnostics]
  const data: SkillAdditionApplyData = { applied: false, plan }
  if (hasErrors(diagnostics) || !plan.addition) return result(data, diagnostics)

  if (!options.authorized) {
    diagnostics.push(
      diagnostic("ASTR7106", "error", "Adding a Skill requires explicit authorization", {
        remediation: "Review the plan, then authorize that exact plan.",
      }),
    )
    return result(data, diagnostics)
  }
  if (options.expectedPlanId !== undefined && options.expectedPlanId !== plan.planId) {
    diagnostics.push(
      diagnostic("ASTR7107", "error", "Skill plan does not match the reviewed plan", {
        remediation: "Run a new dry-run, review it, and authorize its planId.",
        details: { expected: options.expectedPlanId, actual: plan.planId },
      }),
    )
    return result(data, diagnostics)
  }

  if (plan.inputBindings !== undefined) {
    const current = await loadWorkspace({ cwd: plan.root, config: plan.configPath, install: true })
    if (configBindingSnapshot(current.configs) !== plan.inputBindings)
      return result(data, [
        diagnostic(
          "ASTR1119",
          "error",
          "Config input bindings changed after preview; prepare a new plan",
        ),
      ])
  }
  const lock = await acquireOperationLock(plan.root)
  const originals = new Map<string, string | undefined>()
  let writesStarted = false
  try {
    for (const file of plan.files) {
      const current = await readTextIfExists(file.path)
      originals.set(file.path, current)
      if (hashOptional(current) !== file.beforeDigest) {
        diagnostics.push(
          diagnostic("ASTR7108", "error", `Skill plan is stale for ${file.path}`, {
            remediation: "Run a new dry-run and review the updated plan.",
            details: { expected: file.beforeDigest, actual: hashOptional(current) },
          }),
        )
      }
    }
    if (hasErrors(diagnostics)) return result(data, diagnostics)

    for (const file of plan.files) {
      const current = originals.get(file.path)
      if (current === undefined) {
        diagnostics.push(
          diagnostic("ASTR7108", "error", `Skill target manifest is missing: ${file.path}`),
        )
        return result(data, diagnostics)
      }
      const content = renderSkillEdit(current, plan.addition.id, file.capabilityValue)
      if (hash(content) !== file.afterDigest) {
        diagnostics.push(
          diagnostic("ASTR7109", "error", `Skill plan rendering changed for ${file.path}`, {
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
    const capability = verified.capabilities.find(
      (item) => item.id === plan.addition?.id && item.kind === "skill",
    )
    if (
      verificationErrors.length > 0 ||
      !capability ||
      capability.identity !== plan.addition.capability.identity
    ) {
      diagnostics.push(
        ...verificationErrors,
        diagnostic("ASTR7110", "error", "Skill addition failed composed verification", {
          remediation: "The original manifest was restored.",
        }),
      )
      diagnostics.push(...(await restoreFiles(originals)))
      return result(data, uniqueDiagnostics(diagnostics))
    }
    journalChange({
      kind: "skill",
      target: capability.id,
      action: "declare",
      before: null,
      after: {
        identity: capability.identity,
        version: capability.version,
        sourceType: capability.source.type,
      },
    })
    return result(
      { applied: true, plan, capability },
      uniqueDiagnostics([...diagnostics, ...verified.diagnostics]),
    )
  } catch (error) {
    if (writesStarted) diagnostics.push(...(await restoreFiles(originals)))
    diagnostics.push(
      diagnostic(
        "ASTR7111",
        "error",
        `Failed to apply Skill plan: ${error instanceof Error ? error.message : String(error)}`,
        { remediation: "The original manifest was restored when possible." },
      ),
    )
    return result(data, uniqueDiagnostics(diagnostics))
  } finally {
    await lock.release()
  }
}

export function normalizeSkillAddition(
  input: unknown,
  capabilities: Record<string, Capability>,
  diagnostics: Diagnostic[],
): NormalizedSkillAddition | null {
  if (!isRecord(input)) {
    diagnostics.push(diagnostic("ASTR7101", "error", "Skill input must be a JSON object"))
    return null
  }
  validateKnownFields(
    input,
    ["id", "identity", "version", "exposeAs", "description", "source", "trust"],
    "Skill input",
    diagnostics,
  )
  const identity = optionalString(input.identity, "identity", diagnostics)
  if (!identity) {
    diagnostics.push(diagnostic("ASTR7101", "error", "Skill input requires identity"))
    return null
  }
  const source = normalizeSkillSource(input.source, diagnostics)
  if (!source) return null
  const derived = deriveIdentifier(identity)
  const id = optionalString(input.id, "id", diagnostics) ?? derived
  const exposeAs = optionalString(input.exposeAs, "exposeAs", diagnostics) ?? derived
  if (!validIdentifier(id)) {
    diagnostics.push(diagnostic("ASTR7101", "error", `Invalid Skill ID ${id || "<missing>"}`))
  }
  if (!validIdentifier(exposeAs)) {
    diagnostics.push(
      diagnostic("ASTR7101", "error", `Invalid Skill alias ${exposeAs || "<missing>"}`),
    )
  }
  const version = optionalString(input.version, "version", diagnostics)
  const description = optionalString(input.description, "description", diagnostics)
  const instructions = normalizeTrust(input.trust, diagnostics)
  const capability: Capability = {
    kind: "skill",
    identity,
    ...(version ? { version } : {}),
    exposeAs,
    ...(description ? { description } : {}),
    source,
    ...(instructions === "trusted" ? { trust: { instructions } } : {}),
  }
  if (source.type === "git" && instructions !== "trusted") {
    diagnostics.push(
      diagnostic(
        "ASTR7104",
        "warning",
        `Git Skill ${identity} will remain inactive until its instructions are trusted`,
      ),
    )
  }
  if (capabilities[id]) {
    diagnostics.push(
      diagnostic("ASTR7102", "error", `Capability ${id} already exists`, {
        remediation: "Choose a different Skill ID. Updating Capabilities is a separate operation.",
      }),
    )
  }
  return { id, capability }
}

function normalizeSkillSource(
  value: unknown,
  diagnostics: Diagnostic[],
): SkillAdditionSource | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    diagnostics.push(
      diagnostic("ASTR7101", "error", "Skill input requires source.type", {
        remediation: "Use git, workspace, or repository.",
      }),
    )
    return null
  }
  if (value.type === "git") {
    validateKnownFields(value, ["type", "url", "revision", "path"], "Git Skill source", diagnostics)
    const url = optionalString(value.url, "source.url", diagnostics)
    const path = optionalString(value.path, "source.path", diagnostics)
    const revision = normalizeRevision(value.revision, diagnostics)
    if (!url || !path || !revision) return null
    validateSafePath(path, diagnostics)
    return { type: "git", url, revision, path }
  }
  if (value.type === "workspace") {
    validateKnownFields(value, ["type", "path"], "Workspace Skill source", diagnostics)
    const path = optionalString(value.path, "source.path", diagnostics)
    if (!path) return null
    validateSafePath(path, diagnostics)
    return { type: "workspace", path }
  }
  if (value.type === "repository") {
    validateKnownFields(
      value,
      ["type", "repository", "path"],
      "repository Skill source",
      diagnostics,
    )
    const repository = optionalString(value.repository, "source.repository", diagnostics)
    const path = optionalString(value.path, "source.path", diagnostics)
    if (!repository || !path) return null
    validateSafePath(path, diagnostics)
    return { type: "repository", repository, path }
  }
  diagnostics.push(
    diagnostic("ASTR7101", "error", `Unsupported Skill source type ${value.type}`, {
      remediation: "Use git, workspace, or repository.",
    }),
  )
  return null
}

function normalizeRevision(
  value: unknown,
  diagnostics: Diagnostic[],
): { branch?: string; tag?: string; commit?: string } | undefined {
  if (!isRecord(value)) {
    diagnostics.push(
      diagnostic("ASTR7101", "error", "Git Skill revision requires one branch, tag, or commit"),
    )
    return undefined
  }
  validateKnownFields(value, ["branch", "tag", "commit"], "Git Skill revision", diagnostics)
  const entries = (["branch", "tag", "commit"] as const).flatMap((key) =>
    typeof value[key] === "string" && value[key].trim() ? [[key, value[key].trim()] as const] : [],
  )
  if (entries.length !== 1) {
    diagnostics.push(
      diagnostic("ASTR7101", "error", "Git Skill revision requires one branch, tag, or commit"),
    )
    return undefined
  }
  return Object.fromEntries(entries)
}

function normalizeTrust(
  value: unknown,
  diagnostics: Diagnostic[],
): "trusted" | "disabled" | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("ASTR7101", "error", "Skill trust must be an object"))
    return undefined
  }
  validateKnownFields(value, ["instructions"], "Skill trust", diagnostics)
  if (
    value.instructions !== undefined &&
    value.instructions !== "trusted" &&
    value.instructions !== "disabled"
  ) {
    diagnostics.push(
      diagnostic("ASTR7101", "error", "Skill instruction trust must be trusted or disabled"),
    )
    return undefined
  }
  return value.instructions
}

export function validateSkillAddition(
  addition: NormalizedSkillAddition,
  capabilities: Record<string, Capability>,
  repositories: Record<string, unknown>,
  diagnostics: Diagnostic[],
): void {
  const source = addition.capability.source
  if (source?.type === "repository" && !repositories[source.repository ?? ""]) {
    diagnostics.push(
      diagnostic(
        "ASTR7103",
        "error",
        `Skill ${addition.id} references unknown repository ${source.repository ?? "<missing>"}`,
      ),
    )
  }
  const alias = addition.capability.exposeAs
  for (const [id, capability] of Object.entries(capabilities)) {
    if (capability.disabled === true) continue
    const existingAlias = capability.exposeAs ?? deriveIdentifier(capability.identity)
    if (alias && existingAlias === alias) {
      diagnostics.push(
        diagnostic("ASTR7103", "error", `Skill alias ${alias} conflicts with Capability ${id}`),
      )
    }
  }
}

function validateSafePath(path: string, diagnostics: Diagnostic[]): void {
  const normalized = normalize(path)
  if (
    isAbsolute(path) ||
    path.includes("\\") ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`)
  ) {
    diagnostics.push(
      diagnostic("ASTR7101", "error", `Skill source path must be safely relative: ${path}`),
    )
  }
}

function renderSkillEdit(
  current: string,
  id: string,
  capabilityValue: Record<string, unknown>,
): string {
  const document = parseDocument(current, { strict: true, uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "Invalid YAML")
  document.setIn(["capabilities", id], capabilityValue)
  return document.toString({ lineWidth: 0 })
}

async function restoreFiles(originals: Map<string, string | undefined>): Promise<Diagnostic[]> {
  const { rm } = await import("node:fs/promises")
  const diagnostics: Diagnostic[] = []
  for (const [path, content] of originals) {
    try {
      if (content === undefined) await rm(path, { force: true })
      else await atomicWrite(path, content)
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR7112",
          "error",
          `Failed to restore ${path}: ${error instanceof Error ? error.message : String(error)}`,
          { remediation: "Restore this manifest from version control or backup before retrying." },
        ),
      )
    }
  }
  return diagnostics
}

function deriveIdentifier(identity: string): string {
  return (identity.split("/").filter(Boolean).at(-1) ?? "")
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function validIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(value)
}

function optionalString(
  value: unknown,
  name: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    diagnostics.push(diagnostic("ASTR7101", "error", `Skill ${name} must be a string`))
    return undefined
  }
  return value.trim() || undefined
}

function validateKnownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    diagnostics.push(
      diagnostic("ASTR7101", "error", `Unknown ${label} field ${key}`, {
        remediation: "Remove the field or use a supported Skill authoring property.",
      }),
    )
  }
}

function hashOptional(value: string | undefined): string {
  return hash(value === undefined ? "<astrail:missing>" : value)
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
