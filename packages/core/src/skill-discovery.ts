import { createHash } from "node:crypto"
import { lstat, readdir, realpath, rm } from "node:fs/promises"
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path"
import type { Capability } from "astrail-schema"
import { parse, parseDocument } from "yaml"
import { acquireOperationLock, atomicWrite, pathExists, readTextIfExists } from "./fs.js"
import { journalChange, journalTargets } from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import { resolveWorkspace } from "./resolver.js"
import {
  type NormalizedSkillAddition,
  normalizeSkillAddition,
  validateSkillAddition,
} from "./skill-authoring.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedCapability,
  type Result,
  result,
} from "./types.js"

export const SKILL_DISCOVERY_DIRECTORIES = [".agents/skills", ".codex/skills", "skills"] as const

export interface SkillDiscoveryScope {
  all?: boolean
  repositories?: string[]
}

export interface SkillDiscoveryConflict {
  field: "identity" | "id" | "alias"
  value: string
  with: string[]
}

export interface DiscoveredSkillCandidate {
  key: string
  repository: string
  path: string
  skillFile: string
  physicalSkillFile: string
  name?: string
  description?: string
  proposedIdentity?: string
  proposedId?: string
  proposedAlias?: string
  instructionsTrusted: boolean
  fingerprint: string
  alreadyDeclared: boolean
  existingCapability?: string
  importable: boolean
  conflicts: SkillDiscoveryConflict[]
  diagnostics: Diagnostic[]
}

export interface SkillDiscoveryResult {
  root: string
  scope: { repositories: string[] }
  conventions: readonly string[]
  candidates: DiscoveredSkillCandidate[]
  diagnostics: Diagnostic[]
}

export interface RepositorySkillInventoryCandidate {
  key: string
  repository: string
  path: string
  name?: string
  description?: string
  proposedIdentity?: string
  proposedId?: string
  proposedAlias?: string
  instructionsTrusted: boolean
  importable: boolean
  conflicts: SkillDiscoveryConflict[]
  diagnostics: Diagnostic[]
}

export interface RepositorySkillInventory {
  repositories: string[]
  unavailableRepositories: string[]
  discovered: number
  imported: number
  unimported: number
  importable: number
  candidates: RepositorySkillInventoryCandidate[]
}

export interface SkillImportSelection {
  repository: string
  path: string
  identity?: string
  id?: string
  exposeAs?: string
  version?: string
  description?: string
  trust?: { instructions?: "trusted" | "disabled" }
}

export interface SkillImportRequest {
  selections: SkillImportSelection[]
}

export interface SkillImportSource {
  repository: string
  path: string
  skillFile: string
  physicalSkillFile: string
  fingerprint: string
}

export interface SkillImportFileChange {
  path: string
  kind: "update"
  beforeDigest: string
  afterDigest: string
  capabilityValues: Array<{ id: string; value: Record<string, unknown> }>
}

export interface SkillImportPlan {
  operation: "skill-import"
  planId: string
  root: string
  configPath: string
  additions: NormalizedSkillAddition[]
  sources: SkillImportSource[]
  files: SkillImportFileChange[]
  actions: Array<{
    id: string
    type: "write"
    target: string
    description: string
    requiresAuthorization: true
  }>
  diagnostics: Diagnostic[]
}

export interface SkillImportApplyData {
  applied: boolean
  plan: SkillImportPlan
  capabilities: ResolvedCapability[]
}

export interface SkillImportApplyOptions {
  authorized?: boolean
  expectedPlanId?: string
}

export async function discoverRepositorySkills(
  scope: SkillDiscoveryScope = { all: true },
  options: { cwd?: string; config?: string } = {},
): Promise<SkillDiscoveryResult> {
  const workspace = await resolveWorkspace({ ...options, observe: true })
  const diagnostics = [...workspace.diagnostics]
  const repositoriesById = new Map(
    workspace.topology.repositories.map((repository) => [repository.id, repository]),
  )
  const requested = normalizeScope(scope, [...repositoriesById.keys()], diagnostics)
  const candidates = (
    await Promise.all(
      requested.map(async (id) => {
        const repository = repositoriesById.get(id)
        if (!repository) {
          diagnostics.push(
            diagnostic("ASTR7201", "error", `Unknown repository ${id} for Skill discovery`),
          )
          return []
        }
        if (!repository.path || repository.observation?.present !== true) {
          diagnostics.push(
            diagnostic(
              "ASTR7202",
              "warning",
              `Repository ${id} is unavailable for Skill discovery`,
              {
                details: { repository: id, path: repository.path },
                remediation: "Prepare the repository, then run Skill discovery again.",
              },
            ),
          )
          return []
        }
        return scanRepository(id, repository.path, repository.trust.instructions === "trusted")
      }),
    )
  ).flat()

  analyzeCandidates(candidates, workspace.config.capabilities ?? {})
  candidates.sort(
    (left, right) =>
      left.repository.localeCompare(right.repository) || left.path.localeCompare(right.path),
  )
  return {
    root: workspace.root,
    scope: { repositories: requested },
    conventions: SKILL_DISCOVERY_DIRECTORIES,
    candidates,
    diagnostics: uniqueDiagnostics(diagnostics),
  }
}

export function summarizeRepositorySkillDiscovery(
  discovery: SkillDiscoveryResult,
): RepositorySkillInventory {
  const unimported = discovery.candidates.filter((candidate) => !candidate.alreadyDeclared)
  return {
    repositories: [...discovery.scope.repositories],
    unavailableRepositories: [
      ...new Set(
        discovery.diagnostics.flatMap((item) => {
          if (item.code !== "ASTR7202") return []
          const repository = item.details?.repository
          return typeof repository === "string" ? [repository] : []
        }),
      ),
    ].sort(),
    discovered: discovery.candidates.length,
    imported: discovery.candidates.filter((candidate) => candidate.alreadyDeclared).length,
    unimported: unimported.length,
    importable: unimported.filter((candidate) => candidate.importable).length,
    candidates: unimported.map((candidate) => ({
      key: candidate.key,
      repository: candidate.repository,
      path: candidate.path,
      ...(candidate.name ? { name: candidate.name } : {}),
      ...(candidate.description ? { description: candidate.description } : {}),
      ...(candidate.proposedIdentity ? { proposedIdentity: candidate.proposedIdentity } : {}),
      ...(candidate.proposedId ? { proposedId: candidate.proposedId } : {}),
      ...(candidate.proposedAlias ? { proposedAlias: candidate.proposedAlias } : {}),
      instructionsTrusted: candidate.instructionsTrusted,
      importable: candidate.importable,
      conflicts: candidate.conflicts,
      diagnostics: candidate.diagnostics,
    })),
  }
}

export async function planSkillImport(
  input: unknown,
  options: { cwd?: string; config?: string } = {},
): Promise<SkillImportPlan> {
  const loaded = await loadWorkspace(options)
  const workspace = await resolveWorkspace(options)
  const diagnostics = uniqueDiagnostics([...loaded.diagnostics, ...workspace.diagnostics])
  const selections = normalizeImportRequest(input, diagnostics)
  const additions: NormalizedSkillAddition[] = []
  const sources: SkillImportSource[] = []
  const files: SkillImportFileChange[] = []

  if (selections.length > 0) {
    const repositoryIds = [...new Set(selections.map((selection) => selection.repository))].sort()
    const discovery = await discoverRepositorySkills({ repositories: repositoryIds }, options)
    diagnostics.push(...discovery.diagnostics)
    const byKey = new Map(discovery.candidates.map((candidate) => [candidate.key, candidate]))
    const capabilities: Record<string, Capability> = {
      ...(workspace.config.capabilities ?? {}),
    }
    const selectedKeys = new Set<string>()
    for (const selection of selections) {
      const normalizedPath = safeRelativePath(selection.path)
      const key = candidateKey(selection.repository, normalizedPath ?? selection.path)
      if (selectedKeys.has(key)) {
        diagnostics.push(
          diagnostic("ASTR7211", "error", `Skill candidate ${key} was selected twice`),
        )
        continue
      }
      selectedKeys.add(key)
      const candidate = byKey.get(key)
      if (!candidate?.importable) {
        diagnostics.push(
          diagnostic("ASTR7212", "error", `Skill selection ${key} is not currently importable`, {
            remediation: "Run skill discover again and select a current importable candidate.",
          }),
        )
        continue
      }
      const addition = normalizeSkillAddition(
        {
          ...(selection.id ? { id: selection.id } : {}),
          identity: selection.identity ?? candidate.proposedIdentity,
          ...(selection.version ? { version: selection.version } : {}),
          exposeAs: selection.exposeAs ?? candidate.proposedAlias,
          ...((selection.description ?? candidate.description)
            ? { description: selection.description ?? candidate.description }
            : {}),
          source: {
            type: "repository",
            repository: candidate.repository,
            path: candidate.path,
          },
          ...(selection.trust ? { trust: selection.trust } : {}),
        },
        capabilities,
        diagnostics,
      )
      if (!addition) continue
      validateSkillAddition(
        addition,
        capabilities,
        workspace.config.repositories ?? {},
        diagnostics,
      )
      const duplicateIdentity = Object.entries(capabilities).find(
        ([, capability]) =>
          capability.disabled !== true && capability.identity === addition.capability.identity,
      )
      if (duplicateIdentity) {
        diagnostics.push(
          diagnostic(
            "ASTR7213",
            "error",
            `Skill identity ${addition.capability.identity} conflicts with Capability ${duplicateIdentity[0]}`,
          ),
        )
      }
      additions.push(addition)
      capabilities[addition.id] = addition.capability
      sources.push({
        repository: candidate.repository,
        path: candidate.path,
        skillFile: candidate.skillFile,
        physicalSkillFile: candidate.physicalSkillFile,
        fingerprint: candidate.fingerprint,
      })
    }
  }

  if (additions.length > 0 && !hasErrors(diagnostics)) {
    const current = await readTextIfExists(loaded.configPath)
    try {
      if (current === undefined) throw new Error(`Manifest is unavailable: ${loaded.configPath}`)
      const capabilityValues = additions.map((addition) => ({
        id: addition.id,
        value: addition.capability as unknown as Record<string, unknown>,
      }))
      const next = renderSkillImports(current, capabilityValues)
      files.push({
        path: loaded.configPath,
        kind: "update",
        beforeDigest: hashOptional(current),
        afterDigest: hash(next),
        capabilityValues,
      })
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR7214",
          "error",
          `Cannot edit ${loaded.configPath}: ${error instanceof Error ? error.message : String(error)}`,
          { remediation: "Repair the YAML file before importing Skills." },
        ),
      )
    }
  }

  const planId = hash(
    stableStringify({
      root: loaded.root,
      additions,
      sources,
      files: files.map(({ path, beforeDigest, afterDigest, capabilityValues }) => ({
        path,
        beforeDigest,
        afterDigest,
        capabilityValues,
      })),
    }),
  )
  journalTargets({
    skills: additions.map((addition) => addition.id),
    repositories: sources.map((source) => source.repository),
    planId,
  })
  return {
    operation: "skill-import",
    planId,
    root: loaded.root,
    configPath: loaded.configPath,
    additions,
    sources,
    files,
    actions: files.map((file) => ({
      id: "write:shared:skill-import",
      type: "write",
      target: file.path,
      description: `Import ${additions.length} repository Skill${additions.length === 1 ? "" : "s"}`,
      requiresAuthorization: true,
    })),
    diagnostics: uniqueDiagnostics(diagnostics),
  }
}

export async function applySkillImport(
  plan: SkillImportPlan,
  options: SkillImportApplyOptions = {},
): Promise<Result<SkillImportApplyData>> {
  journalTargets({
    skills: plan.additions.map((addition) => addition.id),
    repositories: plan.sources.map((source) => source.repository),
    planId: plan.planId,
  })
  const diagnostics = [...plan.diagnostics]
  const data: SkillImportApplyData = { applied: false, plan, capabilities: [] }
  if (hasErrors(diagnostics) || plan.additions.length === 0) return result(data, diagnostics)
  if (!options.authorized) {
    diagnostics.push(
      diagnostic("ASTR7221", "error", "Importing Skills requires explicit authorization", {
        remediation: "Review the plan, then authorize that exact plan.",
      }),
    )
    return result(data, diagnostics)
  }
  if (options.expectedPlanId !== undefined && options.expectedPlanId !== plan.planId) {
    diagnostics.push(
      diagnostic("ASTR7222", "error", "Skill import plan does not match the reviewed plan", {
        remediation: "Run a new dry-run, review it, and authorize its planId.",
        details: { expected: options.expectedPlanId, actual: plan.planId },
      }),
    )
    return result(data, diagnostics)
  }

  const lock = await acquireOperationLock(plan.root)
  const originals = new Map<string, string | undefined>()
  let writesStarted = false
  try {
    for (const source of plan.sources) {
      const current = await readTextIfExists(source.skillFile)
      const currentPhysical = await realpath(source.skillFile).catch(() => undefined)
      if (
        !current ||
        hash(current) !== source.fingerprint ||
        currentPhysical !== source.physicalSkillFile
      ) {
        diagnostics.push(
          diagnostic(
            "ASTR7223",
            "error",
            `Skill import source changed: ${source.repository}/${source.path}`,
            {
              remediation: "Run a new discovery and dry-run before importing.",
            },
          ),
        )
      }
    }
    for (const file of plan.files) {
      const current = await readTextIfExists(file.path)
      originals.set(file.path, current)
      if (hashOptional(current) !== file.beforeDigest) {
        diagnostics.push(
          diagnostic("ASTR7224", "error", `Skill import plan is stale for ${file.path}`, {
            remediation: "Run a new dry-run and review the updated plan.",
          }),
        )
      }
    }
    if (hasErrors(diagnostics)) return result(data, uniqueDiagnostics(diagnostics))

    for (const file of plan.files) {
      const current = originals.get(file.path)
      if (current === undefined) {
        diagnostics.push(
          diagnostic("ASTR7224", "error", `Skill target manifest is missing: ${file.path}`),
        )
        return result(data, uniqueDiagnostics(diagnostics))
      }
      const content = renderSkillImports(current, file.capabilityValues)
      if (hash(content) !== file.afterDigest) {
        diagnostics.push(
          diagnostic("ASTR7225", "error", `Skill import rendering changed for ${file.path}`, {
            remediation: "Run a new dry-run with the current Astrail version.",
          }),
        )
        return result(data, uniqueDiagnostics(diagnostics))
      }
      writesStarted = true
      await atomicWrite(file.path, content)
    }

    const verified = await resolveWorkspace({ cwd: plan.root, config: plan.configPath })
    const verificationErrors = verified.diagnostics.filter((item) => item.severity === "error")
    const capabilities = plan.additions.flatMap((addition) => {
      const capability = verified.capabilities.find(
        (item) => item.id === addition.id && item.kind === "skill",
      )
      return capability && capability.identity === addition.capability.identity ? [capability] : []
    })
    if (verificationErrors.length > 0 || capabilities.length !== plan.additions.length) {
      diagnostics.push(
        ...verificationErrors,
        diagnostic("ASTR7226", "error", "Skill import failed composed verification", {
          remediation: "The original manifest was restored.",
        }),
      )
      diagnostics.push(...(await restoreFiles(originals)))
      return result(data, uniqueDiagnostics(diagnostics))
    }
    for (const capability of capabilities)
      journalChange({
        kind: "skill",
        target: capability.id,
        action: "import",
        before: null,
        after: {
          identity: capability.identity,
          version: capability.version,
          sourceType: capability.source.type,
        },
      })
    return result(
      { applied: true, plan, capabilities },
      uniqueDiagnostics([...diagnostics, ...verified.diagnostics]),
    )
  } catch (error) {
    if (writesStarted) diagnostics.push(...(await restoreFiles(originals)))
    diagnostics.push(
      diagnostic(
        "ASTR7227",
        "error",
        `Failed to apply Skill import plan: ${error instanceof Error ? error.message : String(error)}`,
        { remediation: "The original manifest was restored when possible." },
      ),
    )
    return result(data, uniqueDiagnostics(diagnostics))
  } finally {
    await lock.release()
  }
}

async function scanRepository(
  repository: string,
  repositoryPath: string,
  instructionsTrusted: boolean,
): Promise<DiscoveredSkillCandidate[]> {
  const candidates: DiscoveredSkillCandidate[] = []
  const physicalRoot = await realpath(repositoryPath)
  const seenPhysical = new Set<string>()
  for (const convention of SKILL_DISCOVERY_DIRECTORIES) {
    const directory = resolve(repositoryPath, convention)
    if (!(await pathExists(directory))) continue
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const skillDirectory = join(directory, entry.name)
      const info = await lstat(skillDirectory).catch(() => undefined)
      if (!info || (!info.isDirectory() && !info.isSymbolicLink())) continue
      const skillFile = join(skillDirectory, "SKILL.md")
      const content = await readTextIfExists(skillFile)
      if (content === undefined) continue
      const physicalDirectory = await realpath(skillDirectory).catch(() => undefined)
      const physicalFile = await realpath(skillFile).catch(() => undefined)
      if (
        !physicalDirectory ||
        !physicalFile ||
        !containedBy(physicalRoot, physicalDirectory) ||
        !containedBy(physicalRoot, physicalFile) ||
        seenPhysical.has(physicalDirectory)
      ) {
        continue
      }
      seenPhysical.add(physicalDirectory)
      const path = relative(repositoryPath, skillDirectory).split(sep).join("/")
      const candidateDiagnostics: Diagnostic[] = []
      const metadata = skillMetadata(content, repository, path, candidateDiagnostics)
      const proposedIdentity = metadata.name ? `${repository}/${metadata.name}` : undefined
      const proposedId = metadata.name ? deriveIdentifier(metadata.name) : undefined
      candidates.push({
        key: candidateKey(repository, path),
        repository,
        path,
        skillFile,
        physicalSkillFile: physicalFile,
        ...(metadata.name ? { name: metadata.name } : {}),
        ...(metadata.description ? { description: metadata.description } : {}),
        ...(proposedIdentity ? { proposedIdentity } : {}),
        ...(proposedId ? { proposedId, proposedAlias: proposedId } : {}),
        instructionsTrusted,
        fingerprint: hash(content),
        alreadyDeclared: false,
        importable: Boolean(metadata.name),
        conflicts: [],
        diagnostics: candidateDiagnostics,
      })
    }
  }
  return candidates
}

function skillMetadata(
  content: string,
  repository: string,
  path: string,
  diagnostics: Diagnostic[],
): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
  if (!match) {
    diagnostics.push(
      diagnostic("ASTR7203", "warning", `Skill ${repository}/${path} has no YAML frontmatter`),
    )
    return {}
  }
  try {
    const value = parse(match[1] ?? "")
    if (!isRecord(value) || typeof value.name !== "string" || !validIdentifier(value.name.trim())) {
      diagnostics.push(
        diagnostic("ASTR7203", "warning", `Skill ${repository}/${path} has an invalid name`),
      )
      return {}
    }
    return {
      name: value.name.trim(),
      ...(typeof value.description === "string" && value.description.trim()
        ? { description: value.description.trim() }
        : {}),
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        "ASTR7203",
        "warning",
        `Skill ${repository}/${path} has invalid frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
    return {}
  }
}

function analyzeCandidates(
  candidates: DiscoveredSkillCandidate[],
  capabilities: Record<string, Capability>,
): void {
  const existing = Object.entries(capabilities).filter(
    ([, capability]) => capability.disabled !== true,
  )
  for (const candidate of candidates) {
    const declaration = existing.find(([, capability]) => {
      const source = capability.source
      return (
        capability.kind === "skill" &&
        source?.type === "repository" &&
        source.repository === candidate.repository &&
        normalizeSlashes(normalize(source.path ?? "")) === candidate.path
      )
    })
    if (declaration) {
      candidate.alreadyDeclared = true
      candidate.existingCapability = declaration[0]
      candidate.importable = false
    }
  }

  for (const candidate of candidates) {
    for (const field of ["identity", "id", "alias"] as const) {
      const value =
        field === "identity"
          ? candidate.proposedIdentity
          : field === "id"
            ? candidate.proposedId
            : candidate.proposedAlias
      if (!value) continue
      const conflicts = new Set<string>()
      for (const [id, capability] of existing) {
        const existingValue =
          field === "identity"
            ? capability.identity
            : field === "id"
              ? id
              : (capability.exposeAs ?? deriveIdentifier(capability.identity))
        if (existingValue === value) conflicts.add(`capability:${id}`)
      }
      for (const other of candidates) {
        if (other.key === candidate.key) continue
        const otherValue =
          field === "identity"
            ? other.proposedIdentity
            : field === "id"
              ? other.proposedId
              : other.proposedAlias
        if (otherValue === value) conflicts.add(`candidate:${other.key}`)
      }
      if (conflicts.size > 0) {
        candidate.conflicts.push({ field, value, with: [...conflicts].sort() })
      }
    }
  }
}

function normalizeScope(
  scope: SkillDiscoveryScope,
  available: string[],
  diagnostics: Diagnostic[],
): string[] {
  const repositories = [
    ...new Set((scope.repositories ?? []).map((item) => item.trim()).filter(Boolean)),
  ]
  if (scope.all && repositories.length > 0) {
    diagnostics.push(
      diagnostic("ASTR7201", "error", "Skill discovery scope cannot combine all and repositories"),
    )
  }
  if (!scope.all && repositories.length === 0) {
    diagnostics.push(
      diagnostic("ASTR7201", "error", "Skill discovery requires all or at least one repository"),
    )
    return []
  }
  return (scope.all ? available : repositories).sort()
}

function normalizeImportRequest(input: unknown, diagnostics: Diagnostic[]): SkillImportSelection[] {
  if (!isRecord(input) || !Array.isArray(input.selections)) {
    diagnostics.push(
      diagnostic("ASTR7210", "error", "Skill import input requires a selections array"),
    )
    return []
  }
  for (const key of Object.keys(input)) {
    if (key !== "selections") {
      diagnostics.push(diagnostic("ASTR7210", "error", `Unknown Skill import field ${key}`))
    }
  }
  if (input.selections.length === 0) {
    diagnostics.push(
      diagnostic("ASTR7210", "error", "Skill import requires one or more selections"),
    )
  }
  return input.selections.flatMap((value, index) => {
    if (!isRecord(value)) {
      diagnostics.push(
        diagnostic("ASTR7210", "error", `Skill import selection ${index + 1} must be an object`),
      )
      return []
    }
    const allowed = [
      "repository",
      "path",
      "identity",
      "id",
      "exposeAs",
      "version",
      "description",
      "trust",
    ]
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) {
        diagnostics.push(
          diagnostic("ASTR7210", "error", `Unknown Skill import selection field ${key}`),
        )
      }
    }
    if (typeof value.repository !== "string" || !value.repository.trim()) {
      diagnostics.push(
        diagnostic("ASTR7210", "error", `Skill import selection ${index + 1} requires repository`),
      )
      return []
    }
    if (typeof value.path !== "string" || !safeRelativePath(value.path)) {
      diagnostics.push(
        diagnostic("ASTR7210", "error", `Skill import selection ${index + 1} requires a safe path`),
      )
      return []
    }
    const selection: SkillImportSelection = {
      repository: value.repository.trim(),
      path: safeRelativePath(value.path) as string,
    }
    for (const field of ["identity", "id", "exposeAs", "version", "description"] as const) {
      if (value[field] === undefined) continue
      if (typeof value[field] !== "string" || !value[field].trim()) {
        diagnostics.push(
          diagnostic(
            "ASTR7210",
            "error",
            `Skill import selection ${field} must be a non-empty string`,
          ),
        )
      } else selection[field] = value[field].trim()
    }
    if (value.trust !== undefined) {
      selection.trust = value.trust as NonNullable<SkillImportSelection["trust"]>
    }
    return [selection]
  })
}

function safeRelativePath(path: string): string | undefined {
  const normalized = normalize(path)
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`)
  ) {
    return undefined
  }
  return normalizeSlashes(normalized)
}

function candidateKey(repository: string, path: string): string {
  return `${repository}:${path}`
}

function containedBy(parent: string, child: string): boolean {
  const fromParent = relative(parent, child)
  return fromParent === "" || (fromParent !== ".." && !fromParent.startsWith(`..${sep}`))
}

function normalizeSlashes(value: string): string {
  return value.split(sep).join("/")
}

function renderSkillImports(
  current: string,
  additions: Array<{ id: string; value: Record<string, unknown> }>,
): string {
  const document = parseDocument(current, { strict: true, uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "Invalid YAML")
  for (const addition of additions) document.setIn(["capabilities", addition.id], addition.value)
  return document.toString({ lineWidth: 0 })
}

async function restoreFiles(originals: Map<string, string | undefined>): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  for (const [path, content] of originals) {
    try {
      if (content === undefined) await rm(path, { force: true })
      else await atomicWrite(path, content)
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR7228",
          "error",
          `Failed to restore ${path}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }
  }
  return diagnostics
}

function deriveIdentifier(value: string): string {
  return value
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function validIdentifier(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(value)
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
