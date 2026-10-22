import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, realpath, rm } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import { satisfies } from "semver"
import { parseDocument, stringify } from "yaml"
import type { GitCapabilityResolution } from "./capability-acquisition.js"
import { acquireConfigs } from "./config-acquisition.js"
import { configCacheRoot } from "./config-source.js"
import {
  type EnvironmentCheckoutStatus,
  getEnvironmentCheckoutStatuses,
} from "./environment-checkout.js"
import { acquireOperationLock, atomicWrite, pathExists, readTextIfExists } from "./fs.js"
import { cloneRepository, inspectRepository } from "./git.js"
import {
  isJournalRecording,
  journalBeforeMutation,
  journalChange,
  journalPath,
  journalStep,
  journalTargets,
} from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import { runProcess } from "./process.js"
import { resolveWorkspace } from "./resolver.js"
import { isRuntimeRequirementDiagnostic } from "./runtime-requirements.js"
import {
  discoverRepositorySkills,
  type RepositorySkillInventory,
  summarizeRepositorySkillDiscovery,
} from "./skill-discovery.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedWorkspace,
  type Result,
  result,
} from "./types.js"

export type ChangeActionType =
  | "clone"
  | "acquire"
  | "write"
  | "remove"
  | "project"
  | "review-plugin"

export interface ChangeAction {
  id: string
  type: ChangeActionType
  target: string
  description: string
  requiresAuthorization: boolean
  details?: Record<string, unknown>
}

export interface ChangePlan {
  operation: "bootstrap" | "sync" | "update" | "lock" | "import"
  actions: ChangeAction[]
  diagnostics: Diagnostic[]
}

export interface ApplyPlanOptions {
  dryRun?: boolean
  authorized?: boolean
}

export interface WorkspaceStatus extends ResolvedWorkspace {
  environmentStatuses: EnvironmentCheckoutStatus[]
}

export interface WorkspaceDoctorData {
  workspace: WorkspaceStatus
  tools: {
    astrail: string
    astrailSupported: boolean
    node: string
    nodeSupported: boolean
    git: string | false
  }
  repositorySkills: RepositorySkillInventory
}

const SUPPORTED_NODE_RANGE = ">=22.12.0"

export async function validateWorkspace(
  options: { cwd?: string; config?: string } = {},
): Promise<Result<{ root: string; layers: string[] }>> {
  const loaded = await loadWorkspace(options)
  const resolved = await resolveWorkspace(options)
  return result(
    { root: loaded.root, layers: loaded.layers.map((layer) => layer.id) },
    resolved.diagnostics,
  )
}

export async function workspaceStatus(
  options: { cwd?: string; config?: string; astrailVersion?: string } = {},
): Promise<Result<WorkspaceStatus>> {
  const resolved = await resolveWorkspace({ ...options, observe: true })
  const environments = await getEnvironmentCheckoutStatuses({ ...options, workspace: resolved })
  const diagnostics = uniqueDiagnostics([...resolved.diagnostics, ...environments.diagnostics])
  return result({ ...resolved, environmentStatuses: environments.data, diagnostics }, diagnostics)
}

export async function doctorWorkspace(
  options: { cwd?: string; config?: string; strict?: boolean; astrailVersion?: string } = {},
  dependencies: { nodeVersion?: string } = {},
): Promise<Result<WorkspaceDoctorData>> {
  const status = await workspaceStatus(options)
  const workspace = status.data
  const [git, skillDiscovery] = await Promise.all([
    runProcess("git", ["--version"]),
    discoverRepositorySkills({ all: true }, options),
  ])
  const repositorySkills = summarizeRepositorySkillDiscovery(skillDiscovery)
  const nodeVersion = dependencies.nodeVersion ?? process.versions.node
  const nodeSupported = satisfies(nodeVersion, SUPPORTED_NODE_RANGE)
  const diagnostics = [...status.diagnostics]
  if (git.exitCode !== 0) diagnostics.push(diagnostic("ASTR6001", "error", "Git is unavailable"))
  if (!nodeSupported) {
    diagnostics.push(
      diagnostic(
        "ASTR6002",
        "error",
        `Node.js ${nodeVersion} does not satisfy the supported range ${SUPPORTED_NODE_RANGE}`,
        { remediation: `Install Node.js ${SUPPORTED_NODE_RANGE}.` },
      ),
    )
  }
  for (const environment of workspace.environmentStatuses) {
    if (!environment.configured || environment.consistent) continue
    const affected = environment.repositories.filter(
      (repository) => repository.status !== "matching",
    )
    diagnostics.push(
      diagnostic(
        "ASTR6003",
        "warning",
        `Environment ${environment.environment} is not on its configured repository branches`,
        {
          remediation: `Review astrail env checkout ${environment.environment} --dry-run.`,
          details: {
            environment: environment.environment,
            desiredBranch: environment.desiredBranch,
            repositories: affected,
          },
        },
      ),
    )
  }
  if (repositorySkills.unimported > 0) {
    diagnostics.push(
      diagnostic(
        "ASTR6004",
        "information",
        `${repositorySkills.unimported} repository Skill${repositorySkills.unimported === 1 ? " is" : "s are"} discoverable but not imported`,
        {
          remediation:
            "Review astrail skill discover --all, selectively import with astrail skill import, then preview astrail install --dry-run.",
          details: { repositorySkills },
        },
      ),
    )
  }
  const repositoriesMissingDescription = workspace.topology.repositories
    .filter((repository) => !repository.description?.trim())
    .map((repository) => repository.id)
    .sort()
  if (repositoriesMissingDescription.length > 0) {
    diagnostics.push(
      diagnostic(
        "ASTR6005",
        "information",
        `${repositoriesMissingDescription.length} enabled repositor${repositoriesMissingDescription.length === 1 ? "y has" : "ies have"} no declared description: ${repositoriesMissingDescription.join(", ")}`,
        {
          remediation:
            "Declare repositories.<id>.description in a reviewed manifest change; interactive repo add collects it for new repositories.",
          details: { repositories: repositoriesMissingDescription },
        },
      ),
    )
  }
  const unique = uniqueDiagnostics(diagnostics)
  const finalDiagnostics = options.strict ? escalateWarnings(unique) : unique
  return result(
    {
      workspace: { ...workspace, diagnostics: finalDiagnostics },
      tools: {
        astrail: workspace.runtime.version,
        astrailSupported: workspace.runtime.supported,
        node: `v${nodeVersion}`,
        nodeSupported,
        git: git.exitCode === 0 ? git.stdout.trim() : false,
      },
      repositorySkills,
    },
    finalDiagnostics,
  )
}

export async function planBootstrap(workspace: ResolvedWorkspace): Promise<ChangePlan> {
  const actions: ChangeAction[] = []
  const diagnostics = workspace.diagnostics.filter(isBootstrapBlockingDiagnostic)
  if (diagnostics.length) return { operation: "bootstrap", actions, diagnostics }
  const acquisitions = new Map<string, string[]>()
  for (const config of workspace.configs) {
    if (config.source.type === "local" || config.available) continue
    const target =
      config.source.type === "http"
        ? config.manifestPath
        : configCacheRoot(workspace.root, config.source)
    if (await pathExists(target)) continue
    const keys = acquisitions.get(target) ?? []
    keys.push(config.key)
    acquisitions.set(target, keys)
  }
  for (const [target, keys] of acquisitions) {
    const config = workspace.configs.find((item) => item.key === keys[0])
    if (!config || config.source.type === "local") continue
    actions.push({
      id: `acquire-config:${config.key}`,
      type: config.source.type === "git" ? "clone" : "acquire",
      target,
      description: `Acquire shared config from ${config.source.url}`,
      requiresAuthorization: true,
      details: { configs: keys, source: config.source },
    })
  }
  if (actions.length) return { operation: "bootstrap", actions, diagnostics }
  for (const repository of workspace.topology.repositories) {
    if (repository.source.type !== "git" || repository.observation?.present) continue
    if (!repository.path) {
      if (repository.required) {
        diagnostics.push(
          diagnostic("ASTR6101", "error", `Required repository ${repository.id} has no local path`),
        )
      }
      continue
    }
    actions.push({
      id: `clone:${repository.id}`,
      type: "clone",
      target: repository.path,
      description: `Clone ${repository.source.url} for repository ${repository.id}`,
      requiresAuthorization: true,
      details: { remote: repository.source.url, repository: repository.id },
    })
  }
  for (const capability of workspace.capabilities) {
    if (capability.kind === "plugin" && !capability.active) {
      actions.push({
        id: `review-plugin:${capability.id}`,
        type: "review-plugin",
        target: capability.identity,
        description: `Review executable Plugin ${capability.identity}`,
        requiresAuthorization: true,
      })
    }
  }
  return { operation: "bootstrap", actions, diagnostics }
}

export async function applyBootstrap(
  workspace: ResolvedWorkspace,
  plan: ChangePlan,
  options: ApplyPlanOptions,
): Promise<Result<ChangePlan>> {
  return journalStep("bootstrap.prepare", () => applyBootstrapObserved(workspace, plan, options), {
    outcome: (value) => ({
      diagnostics: value.diagnostics,
      skipped: options.dryRun ? "dry-run" : plan.actions.length === 0 ? "no-actions" : undefined,
    }),
  })
}

async function applyBootstrapObserved(
  workspace: ResolvedWorkspace,
  plan: ChangePlan,
  options: ApplyPlanOptions,
): Promise<Result<ChangePlan>> {
  const diagnostics = uniqueDiagnostics([
    ...plan.diagnostics,
    ...workspace.diagnostics.filter(isBootstrapBlockingDiagnostic),
  ])
  if (diagnostics.some((item) => item.severity === "error")) return result(plan, diagnostics)
  if (options.dryRun) return result(plan, diagnostics)
  const protectedActions = plan.actions.filter((action) => action.requiresAuthorization)
  if (protectedActions.length && !options.authorized) {
    diagnostics.push(
      diagnostic("ASTR6103", "error", "Bootstrap requires explicit authorization", {
        remediation: "Review the dry-run plan and rerun with --yes.",
      }),
    )
    return result(plan, diagnostics)
  }
  const lock = await acquireOperationLock(workspace.root)
  try {
    for (const action of plan.actions) {
      if (Array.isArray(action.details?.configs)) {
        const keys = action.details.configs
        const configs = workspace.configs.filter((item) => keys.includes(item.key))
        diagnostics.push(
          ...(await acquireConfigs(workspace.root, configs, workspace.runtime.version)),
        )
        if (diagnostics.some((item) => item.severity === "error")) break
        continue
      }
      if (action.type !== "clone") continue
      const remote = String(action.details?.remote ?? "")
      const repositoryId =
        typeof action.details?.repository === "string" ? action.details.repository : undefined
      if (repositoryId) journalTargets({ repositories: [repositoryId] })
      await journalBeforeMutation()
      const before = isJournalRecording()
        ? await inspectRepository(action.target).catch(() => undefined)
        : undefined
      try {
        await mkdir(dirname(action.target), { recursive: true })
        const repositoryId = String(action.details?.repository ?? "")
        const repository = workspace.config.repositories?.[repositoryId]
        await journalStep(
          "repository.clone",
          () =>
            cloneRepository(
              remote,
              action.target,
              repository?.source.type === "git" ? repository.source.revision : undefined,
            ),
          { target: repositoryId },
        )
      } finally {
        const after = before
          ? await inspectRepository(action.target).catch(() => undefined)
          : undefined
        if (before && after && !before.present && after.present)
          journalChange({
            kind: "repository",
            target: repositoryId ?? journalPath(action.target),
            action: "clone",
            before: null,
            after: {
              present: true,
              isGitRepository: after.isGitRepository,
              branch: after.branch ?? null,
              revision: after.revision ?? null,
            },
          })
      }
    }
  } finally {
    await lock.release()
  }
  return result(plan, diagnostics)
}

export async function planLock(
  workspace: ResolvedWorkspace,
  options: { acquisitions?: readonly GitCapabilityResolution[] } = {},
): Promise<ChangePlan> {
  const diagnostics = workspace.diagnostics.filter((item) => item.severity === "error")
  if (diagnostics.length) return { operation: "lock", actions: [], diagnostics }
  const lockPath = join(workspace.root, "astrail.lock.yaml")
  const existing = await readTextIfExists(lockPath)
  const created = await createLockContent(workspace, existing, false, options.acquisitions)
  return {
    operation: "lock",
    actions:
      existing === created.content
        ? []
        : [
            {
              id: "write:lock",
              type: "write",
              target: lockPath,
              description: "Write reproducible config and capability resolution",
              requiresAuthorization: false,
              details: { content: created.content },
            },
          ],
    diagnostics: created.diagnostics,
  }
}

export async function applyFilePlan(
  root: string,
  plan: ChangePlan,
  options: ApplyPlanOptions,
): Promise<Result<ChangePlan>> {
  const diagnostics = [...plan.diagnostics]
  if (diagnostics.some((item) => item.severity === "error")) return result(plan, diagnostics)
  if (options.dryRun) return result(plan, diagnostics)
  if (plan.actions.some((action) => action.requiresAuthorization) && !options.authorized) {
    diagnostics.push(
      diagnostic("ASTR6201", "error", `${plan.operation} requires explicit authorization`, {
        remediation: "Review the plan and rerun with --yes.",
      }),
    )
    return result(plan, diagnostics)
  }
  const lock = await acquireOperationLock(root)
  try {
    for (const action of plan.actions) {
      if (action.type === "write" && typeof action.details?.content === "string") {
        await atomicWrite(action.target, action.details.content)
      } else if (action.type === "remove") {
        const existed = await pathExists(action.target)
        if (existed) await journalBeforeMutation()
        await rm(action.target, { recursive: true, force: true })
        if (existed)
          journalChange({
            kind: "file",
            target: journalPath(action.target),
            action: "remove",
            after: null,
          })
      }
    }
  } finally {
    await lock.release()
  }
  return result(plan, diagnostics)
}

export async function planUpdate(
  workspace: ResolvedWorkspace,
  options: { acquisitions?: readonly GitCapabilityResolution[] } = {},
): Promise<ChangePlan> {
  const diagnostics = workspace.diagnostics.filter((item) => item.severity === "error")
  if (diagnostics.length) return { operation: "update", actions: [], diagnostics }
  const lockPath = join(workspace.root, "astrail.lock.yaml")
  const previousText = await readTextIfExists(lockPath)
  const created = await createLockContent(workspace, previousText, true, options.acquisitions)
  const nextText = created.content
  const actions: ChangeAction[] = []
  if (previousText !== nextText) {
    actions.push({
      id: "update:lock",
      type: "write",
      target: lockPath,
      description:
        "Update compatible local dependency resolutions and preserve prior lock metadata",
      requiresAuthorization: false,
      details: { content: nextText, previous: previousText },
    })
  }
  return { operation: "update", actions, diagnostics: created.diagnostics }
}

export async function restorePreviousLock(root: string): Promise<Result<{ restored: boolean }>> {
  const path = join(root, "astrail.lock.yaml")
  const content = await readTextIfExists(path)
  const parsed = content ? parseDocument(content).toJS() : undefined
  const previous =
    isRecord(parsed) && isRecord(parsed.previous) && isRecord(parsed.previous.lock)
      ? parsed.previous.lock
      : undefined
  if (!previous) {
    return result({ restored: false }, [
      diagnostic("ASTR6202", "error", "No previous lock state is available"),
    ])
  }
  await atomicWrite(path, stringify(previous, { lineWidth: 0, sortMapEntries: true }))
  return result({ restored: true })
}

async function createLockContent(
  workspace: ResolvedWorkspace,
  previousText: string | undefined,
  preservePrevious: boolean,
  acquisitions: readonly GitCapabilityResolution[] = [],
): Promise<{ content: string; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  const previousLock = previousText ? parseDocument(previousText).toJS() : undefined
  const previousCapabilities =
    isRecord(previousLock) && isRecord(previousLock.capabilities) ? previousLock.capabilities : {}
  const acquiredById = new Map(acquisitions.map((item) => [item.capabilityId, item]))
  const capabilities: Record<string, unknown> = {}
  for (const capability of workspace.capabilities) {
    if (capability.source.type === "git") {
      const acquired = acquiredById.get(capability.id)
      const previous = previousCapabilities[capability.id]
      const previousSource = isRecord(previous) ? previous.source : undefined
      if (acquired && gitSourceMatches(capability.source, acquired.source)) {
        capabilities[capability.id] = {
          identity: capability.identity,
          version: capability.version,
          source: {
            ...structuredClone(acquired.source),
            resolvedCommit: acquired.resolvedCommit,
          },
          integrity: acquired.integrity,
        }
      } else if (
        isRecord(previousSource) &&
        lockedGitSourceMatches(capability.source, previousSource)
      ) {
        capabilities[capability.id] = structuredClone(previous)
      } else {
        capabilities[capability.id] = {
          identity: capability.identity,
          version: capability.version,
          source: "git",
        }
        diagnostics.push(
          diagnostic(
            "ASTR6203",
            "warning",
            `Git capability ${capability.identity} has not been acquired`,
            {
              remediation:
                "Run an authorized target synchronization before locking resolved Git provenance.",
            },
          ),
        )
      }
      continue
    }
    capabilities[capability.id] = {
      identity: capability.identity,
      version: capability.version,
      source: capability.source.type,
      ...(capability.path && (await pathExists(capability.path))
        ? { integrity: await hashPath(capability.path) }
        : {}),
    }
  }
  const configs: Record<string, unknown> = {}
  const canonicalRoot = await realpath(workspace.root)
  for (const config of workspace.configs) {
    if (!config.available || !config.integrity) {
      diagnostics.push(
        diagnostic("ASTR6204", "error", `Cannot lock unavailable config ${config.manifestPath}`),
      )
      continue
    }
    configs[config.key] = {
      source:
        config.source.type === "local"
          ? { type: "local", path: relative(canonicalRoot, config.source.path) }
          : config.source,
      integrity: config.integrity,
      ...(config.resolvedCommit ? { resolvedCommit: config.resolvedCommit } : {}),
    }
  }
  const resolution = {
    workspace: workspace.config.metadata.name,
    configs,
    capabilities,
  }
  if (isRecord(previousLock) && sameResolution(previousLock, resolution)) {
    return { content: previousText ?? "", diagnostics }
  }
  const lock: Record<string, unknown> = {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "WorkspaceLock",
    workspace: workspace.config.metadata.name,
    resolvedAt: new Date().toISOString(),
    configs,
    capabilities,
  }
  if (preservePrevious && isRecord(previousLock)) {
    lock.previous = {
      capturedAt: new Date().toISOString(),
      contentSha256: createHash("sha256")
        .update(previousText ?? "")
        .digest("hex"),
      lock: withoutPrevious(previousLock),
    }
  }
  return { content: stringify(lock, { lineWidth: 0, sortMapEntries: true }), diagnostics }
}

function gitSourceMatches(
  left: { type: "git"; url: string; revision: unknown; path: string },
  right: { type: "git"; url: string; revision: unknown; path: string },
): boolean {
  return (
    left.url === right.url &&
    left.path === right.path &&
    stableJson(left.revision) === stableJson(right.revision)
  )
}

function lockedGitSourceMatches(
  declared: { type: "git"; url: string; revision: unknown; path: string },
  locked: Record<string, unknown>,
): boolean {
  return (
    locked.type === "git" &&
    locked.url === declared.url &&
    locked.path === declared.path &&
    typeof locked.resolvedCommit === "string" &&
    stableJson(locked.revision) === stableJson(declared.revision)
  )
}

async function hashPath(path: string): Promise<string> {
  try {
    const hash = createHash("sha256")
    await appendPathHash(hash, path, path)
    return `sha256-${hash.digest("base64")}`
  } catch {
    return `path-${createHash("sha256").update(path).digest("hex")}`
  }
}

async function appendPathHash(
  hash: ReturnType<typeof createHash>,
  root: string,
  path: string,
): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => undefined)
  if (!entries) {
    hash.update(relative(root, path))
    hash.update(await readFile(path))
    return
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git") continue
    const child = join(path, entry.name)
    hash.update(relative(root, child))
    if (entry.isDirectory()) await appendPathHash(hash, root, child)
    else if (entry.isFile()) hash.update(await readFile(child))
  }
}

function sameResolution(previous: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return (
    stableJson({
      workspace: previous.workspace,
      configs: previous.configs ?? {},
      capabilities: previous.capabilities ?? {},
    }) === stableJson(next)
  )
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "undefined"
}

function withoutPrevious(value: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(value)
  delete copy.previous
  return copy
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

function escalateWarnings(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.map((item) =>
    item.severity === "warning" ? { ...item, severity: "error" as const } : item,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isBootstrapBlockingDiagnostic(item: Diagnostic): boolean {
  return (
    isRuntimeRequirementDiagnostic(item) ||
    (item.severity === "error" && /^ASTR(?:10|11)/.test(item.code))
  )
}
