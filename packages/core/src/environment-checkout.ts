import { createHash } from "node:crypto"
import { configBindingSnapshot } from "./config-inputs.js"
import { environmentRepositoryBranch } from "./environment-branches.js"
import { acquireOperationLock } from "./fs.js"
import { inspectRepository } from "./git.js"
import {
  isJournalRecording,
  journalBeforeMutation,
  journalChange,
  journalStep,
  journalTargets,
} from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import { type ProcessResult, runProcess } from "./process.js"
import { resolveWorkspace } from "./resolver.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedWorkspace,
  type Result,
  result,
} from "./types.js"

export type EnvironmentRepositoryConsistency = "matching" | "mismatched" | "missing" | "not-git"

export interface EnvironmentRepositoryStatus {
  repository: string
  path?: string
  physicalPath?: string
  present: boolean
  isGitRepository: boolean
  currentBranch?: string
  desiredBranch?: string
  dirty?: boolean
  branchExists?: boolean
  status: EnvironmentRepositoryConsistency
}

export interface EnvironmentCheckoutStatus {
  environment: string
  configured: boolean
  desiredBranch?: string
  consistent: boolean
  repositories: EnvironmentRepositoryStatus[]
}

export interface EnvironmentCheckoutAction {
  id: string
  type: "noop" | "switch"
  path: string
  repositories: string[]
  fromBranch?: string
  toBranch: string
  dirty: boolean
  branchExists: boolean
  requiresAuthorization: boolean
}

export interface EnvironmentCheckoutPlan {
  operation: "environment-checkout"
  planId: string
  root: string
  configPath: string
  environment: string
  desiredBranch?: string
  actions: EnvironmentCheckoutAction[]
  diagnostics: Diagnostic[]
}

export interface EnvironmentCheckoutApplyData {
  applied: boolean
  plan: EnvironmentCheckoutPlan
  completedActions: string[]
  remainingActions: string[]
  status?: EnvironmentCheckoutStatus
}

export interface EnvironmentCheckoutApplyOptions {
  authorized?: boolean
  expectedPlanId?: string
  switchBranch?: (path: string, branch: string) => Promise<ProcessResult>
}

interface PhysicalObservation {
  path: string
  desiredBranch?: string
  conflicting?: boolean
  repositories: string[]
  present: boolean
  isGitRepository: boolean
  currentBranch?: string
  dirty: boolean
  branchExists: boolean
}

interface ObservedEnvironment {
  inputBindings: string
  root: string
  configPath: string
  environment: string
  configured: boolean
  desiredBranch?: string
  repositories: EnvironmentRepositoryStatus[]
  physical: PhysicalObservation[]
  diagnostics: Diagnostic[]
}

export async function getEnvironmentCheckoutStatus(
  environmentId: string,
  options: { cwd?: string; config?: string } = {},
): Promise<Result<EnvironmentCheckoutStatus | null>> {
  const observed = await observeEnvironment(environmentId, options)
  if (!observed) {
    return result(null, [diagnostic("ASTR7301", "error", `Unknown environment ${environmentId}`)])
  }
  const data = statusFromObservation(observed)
  return result(data, observed.diagnostics)
}

export async function getEnvironmentCheckoutStatuses(
  options: { cwd?: string; config?: string; workspace?: ResolvedWorkspace } = {},
): Promise<Result<EnvironmentCheckoutStatus[]>> {
  const workspace =
    options.workspace ??
    (await resolveWorkspace({
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.config ? { config: options.config } : {}),
      observe: true,
    }))
  const observations = await Promise.all(
    workspace.topology.environments.map(async (environment) => {
      const observed = await observeResolvedEnvironment(
        environment.id,
        workspace,
        `${workspace.root}/astrail.yaml`,
      )
      return observed
    }),
  )
  return result(
    observations.flatMap((observed) => (observed ? [statusFromObservation(observed)] : [])),
    uniqueDiagnostics([
      ...workspace.diagnostics,
      ...observations.flatMap((observed) => observed?.diagnostics ?? []),
    ]),
  )
}

export async function planEnvironmentCheckout(
  environmentId: string,
  options: { cwd?: string; config?: string } = {},
): Promise<EnvironmentCheckoutPlan> {
  const observed = await observeEnvironment(environmentId, options)
  if (!observed) {
    const diagnostics = [diagnostic("ASTR7301", "error", `Unknown environment ${environmentId}`)]
    return emptyPlan(environmentId, options.cwd ?? process.cwd(), diagnostics)
  }

  const diagnostics = [...observed.diagnostics]
  const actions: EnvironmentCheckoutAction[] = []
  if (!observed.configured) {
    diagnostics.push(
      diagnostic(
        "ASTR7302",
        "error",
        `Environment ${environmentId} has no checkout configuration`,
        {
          remediation: `Add environments.${environmentId}.repositories and checkout.branch or checkout.branches before checkout.`,
        },
      ),
    )
  } else {
    for (const repository of observed.repositories) {
      if (repository.status === "missing") {
        diagnostics.push(
          diagnostic(
            "ASTR7304",
            "error",
            `Environment ${environmentId} repository ${repository.repository} is missing`,
            { details: { path: repository.path } },
          ),
        )
      } else if (repository.status === "not-git") {
        diagnostics.push(
          diagnostic(
            "ASTR7304",
            "error",
            `Environment repository ${repository.repository} is not a Git checkout`,
            { details: { path: repository.path } },
          ),
        )
      }
    }
    for (const branch of new Set(
      observed.repositories.flatMap((repository) =>
        repository.desiredBranch ? [repository.desiredBranch] : [],
      ),
    )) {
      const validBranch = await runProcess("git", ["check-ref-format", "--branch", branch])
      if (validBranch.exitCode !== 0) {
        diagnostics.push(diagnostic("ASTR7303", "error", `Invalid environment branch ${branch}`))
      }
    }
    for (const physical of observed.physical) {
      if (physical.conflicting || !physical.desiredBranch) continue
      if (!physical.present) {
        diagnostics.push(
          diagnostic(
            "ASTR7304",
            "error",
            `Environment ${environmentId} repository checkout is missing: ${physical.path}`,
            { details: { repositories: physical.repositories } },
          ),
        )
        continue
      }
      if (!physical.isGitRepository) {
        diagnostics.push(
          diagnostic("ASTR7304", "error", `Environment checkout is not Git: ${physical.path}`, {
            details: { repositories: physical.repositories },
          }),
        )
        continue
      }
      const type = physical.currentBranch === physical.desiredBranch ? "noop" : "switch"
      if (type === "switch" && physical.dirty) {
        diagnostics.push(
          diagnostic("ASTR7305", "error", `Environment checkout is dirty: ${physical.path}`, {
            remediation: "Commit, stash, or otherwise resolve local changes before switching.",
            details: { repositories: physical.repositories },
          }),
        )
      }
      if (!physical.branchExists) {
        diagnostics.push(
          diagnostic(
            "ASTR7306",
            "error",
            `Local branch ${physical.desiredBranch} does not exist in ${physical.path}`,
            {
              remediation:
                "Create or fetch the local branch explicitly, then run environment checkout again.",
              details: { repositories: physical.repositories },
            },
          ),
        )
      }
      actions.push({
        id: `${type}:${hash(physical.path).slice(0, 12)}`,
        type,
        path: physical.path,
        repositories: physical.repositories,
        ...(physical.currentBranch ? { fromBranch: physical.currentBranch } : {}),
        toBranch: physical.desiredBranch,
        dirty: physical.dirty,
        branchExists: physical.branchExists,
        requiresAuthorization: type === "switch",
      })
    }
  }

  actions.sort((left, right) => left.path.localeCompare(right.path))
  const planId = checkoutPlanId({
    root: observed.root,
    inputBindings: observed.inputBindings,
    environment: environmentId,
    desiredBranch: observed.desiredBranch,
    actions,
  })
  journalTargets({
    environments: [environmentId],
    repositories: actions.flatMap((action) => action.repositories),
    planId,
  })
  return {
    operation: "environment-checkout",
    planId,
    root: observed.root,
    configPath: observed.configPath,
    environment: environmentId,
    ...(observed.desiredBranch ? { desiredBranch: observed.desiredBranch } : {}),
    actions,
    diagnostics: uniqueDiagnostics(diagnostics),
  }
}

export async function applyEnvironmentCheckout(
  plan: EnvironmentCheckoutPlan,
  options: EnvironmentCheckoutApplyOptions = {},
): Promise<Result<EnvironmentCheckoutApplyData>> {
  return journalStep(
    "environment.checkout",
    () => applyEnvironmentCheckoutObserved(plan, options),
    { target: plan.environment },
  )
}

async function applyEnvironmentCheckoutObserved(
  plan: EnvironmentCheckoutPlan,
  options: EnvironmentCheckoutApplyOptions = {},
): Promise<Result<EnvironmentCheckoutApplyData>> {
  journalTargets({
    environments: [plan.environment],
    repositories: plan.actions.flatMap((action) => action.repositories),
    planId: plan.planId,
  })
  const diagnostics = [...plan.diagnostics]
  const switchActions = plan.actions.filter((action) => action.type === "switch")
  const data: EnvironmentCheckoutApplyData = {
    applied: false,
    plan,
    completedActions: [],
    remainingActions: switchActions.map((action) => action.id),
  }
  if (hasErrors(diagnostics)) return result(data, diagnostics)
  if (!options.authorized) {
    diagnostics.push(
      diagnostic("ASTR7307", "error", "Environment checkout requires explicit authorization", {
        remediation: "Review the current checkout plan, then authorize that exact plan.",
      }),
    )
    return result(data, diagnostics)
  }
  if (options.expectedPlanId !== undefined && options.expectedPlanId !== plan.planId) {
    diagnostics.push(
      diagnostic("ASTR7308", "error", "Checkout plan does not match the reviewed plan", {
        remediation: "Run a new dry-run, review it, and authorize its planId.",
        details: { expected: options.expectedPlanId, actual: plan.planId },
      }),
    )
    return result(data, diagnostics)
  }

  const lock = await acquireOperationLock(plan.root)
  try {
    const current = await planEnvironmentCheckout(plan.environment, {
      cwd: plan.root,
      config: plan.configPath,
    })
    if (hasErrors(current.diagnostics)) {
      return result(data, uniqueDiagnostics([...diagnostics, ...current.diagnostics]))
    }
    if (current.planId !== plan.planId) {
      diagnostics.push(
        diagnostic("ASTR7309", "error", "Environment checkout plan is stale", {
          remediation: "Run a new dry-run and review the updated repository observations.",
          details: { reviewed: plan.planId, current: current.planId },
        }),
      )
      return result(data, diagnostics)
    }

    const switchBranch =
      options.switchBranch ??
      ((path: string, branch: string) => runProcess("git", ["-C", path, "switch", "--", branch]))
    journalTargets({ pendingRepositories: switchActions.flatMap((action) => action.repositories) })
    for (const action of switchActions) {
      await journalBeforeMutation()
      const before = isJournalRecording()
        ? await inspectRepository(action.path).catch(() => undefined)
        : undefined
      let switched: ProcessResult
      try {
        switched = await switchBranch(action.path, action.toBranch)
      } catch (error) {
        journalTargets({ failedRepositories: action.repositories })
        throw error
      } finally {
        const after = before
          ? await inspectRepository(action.path).catch(() => undefined)
          : undefined
        if (
          before &&
          after &&
          (before.branch !== after.branch || before.revision !== after.revision)
        ) {
          for (const repository of action.repositories)
            journalChange({
              kind: "repository",
              target: repository,
              action: "checkout",
              before: { branch: before.branch ?? null, revision: before.revision ?? null },
              after: { branch: after.branch ?? null, revision: after.revision ?? null },
            })
        }
      }
      if (switched.exitCode !== 0) {
        journalTargets({ failedRepositories: action.repositories })
        diagnostics.push(
          diagnostic(
            "ASTR7310",
            "error",
            `Failed to switch ${action.path} to ${action.toBranch}: ${switched.stderr.trim()}`,
            {
              remediation:
                "Review completedActions and remainingActions; Astrail does not claim cross-repository atomicity.",
              details: {
                repositories: action.repositories,
                completedActions: data.completedActions,
                remainingActions: data.remainingActions,
              },
            },
          ),
        )
        return result(data, diagnostics)
      }
      data.completedActions.push(action.id)
      data.remainingActions = data.remainingActions.filter((id) => id !== action.id)
      journalTargets({
        pendingRepositories: switchActions
          .filter((item) => data.remainingActions.includes(item.id))
          .flatMap((item) => item.repositories),
      })
    }

    const statusResult = await getEnvironmentCheckoutStatus(plan.environment, {
      cwd: plan.root,
      config: plan.configPath,
    })
    if (!statusResult.data?.consistent) {
      diagnostics.push(
        ...statusResult.diagnostics,
        diagnostic("ASTR7311", "error", "Environment checkout failed final verification"),
      )
      return result(data, uniqueDiagnostics(diagnostics))
    }
    return result(
      { ...data, applied: true, status: statusResult.data },
      uniqueDiagnostics([...diagnostics, ...statusResult.diagnostics]),
    )
  } catch (error) {
    diagnostics.push(
      diagnostic(
        "ASTR7312",
        "error",
        `Failed to apply environment checkout: ${error instanceof Error ? error.message : String(error)}`,
        {
          remediation:
            "Review completedActions and remainingActions before retrying; repository state was not reset.",
        },
      ),
    )
    return result(data, diagnostics)
  } finally {
    await lock.release()
  }
}

async function observeEnvironment(
  environmentId: string,
  options: { cwd?: string; config?: string },
): Promise<ObservedEnvironment | null> {
  const loaded = await loadWorkspace(options)
  const workspace = await resolveWorkspace({ ...options, observe: true })
  return observeResolvedEnvironment(environmentId, workspace, loaded.configPath)
}

async function observeResolvedEnvironment(
  environmentId: string,
  workspace: ResolvedWorkspace,
  configPath: string,
): Promise<ObservedEnvironment | null> {
  const environment = workspace.topology.environments.find((item) => item.id === environmentId)
  if (!environment) return null
  const diagnostics = uniqueDiagnostics(workspace.diagnostics)
  const physicalByPath = new Map<string, PhysicalObservation>()
  const repositories: EnvironmentRepositoryStatus[] = []
  const desiredBranch = environment.checkout?.branch

  for (const repositoryId of environment.repositories) {
    const repositoryBranch = environmentRepositoryBranch(environment.checkout, repositoryId)
    const target = repositoryBranch ? { desiredBranch: repositoryBranch } : {}
    const repository = workspace.topology.repositories.find((item) => item.id === repositoryId)
    if (!repository?.path || repository.observation?.present === false) {
      repositories.push({
        repository: repositoryId,
        ...target,
        ...(repository?.path ? { path: repository.path } : {}),
        present: false,
        isGitRepository: false,
        status: "missing",
      })
      continue
    }
    const topLevel = await runProcess("git", [
      "-C",
      repository.path,
      "rev-parse",
      "--show-toplevel",
    ])
    if (topLevel.exitCode !== 0 || !topLevel.stdout.trim()) {
      repositories.push({
        repository: repositoryId,
        ...target,
        path: repository.path,
        present: true,
        isGitRepository: false,
        status: "not-git",
      })
      continue
    }
    const physicalPath = topLevel.stdout.trim()
    let physical = physicalByPath.get(physicalPath)
    if (!physical) {
      const observation = await inspectRepository(physicalPath)
      const branchExists = repositoryBranch
        ? (
            await runProcess("git", [
              "-C",
              physicalPath,
              "show-ref",
              "--verify",
              "--quiet",
              `refs/heads/${repositoryBranch}`,
            ])
          ).exitCode === 0
        : false
      physical = {
        path: physicalPath,
        ...target,
        repositories: [],
        present: observation.present,
        isGitRepository: observation.isGitRepository,
        ...(observation.branch ? { currentBranch: observation.branch } : {}),
        dirty: observation.dirty ?? false,
        branchExists,
      }
      physicalByPath.set(physicalPath, physical)
    }
    if (physical.desiredBranch !== repositoryBranch) physical.conflicting = true
    physical.repositories.push(repositoryId)
    physical.repositories.sort()
    repositories.push({
      repository: repositoryId,
      ...target,
      path: repository.path,
      physicalPath,
      present: physical.present,
      isGitRepository: physical.isGitRepository,
      ...(physical.currentBranch ? { currentBranch: physical.currentBranch } : {}),
      dirty: physical.dirty,
      branchExists:
        physical.desiredBranch === repositoryBranch
          ? physical.branchExists
          : repositoryBranch
            ? (
                await runProcess("git", [
                  "-C",
                  physicalPath,
                  "show-ref",
                  "--verify",
                  "--quiet",
                  `refs/heads/${repositoryBranch}`,
                ])
              ).exitCode === 0
            : false,
      status:
        repositoryBranch && physical.currentBranch === repositoryBranch ? "matching" : "mismatched",
    })
  }

  for (const physical of physicalByPath.values()) {
    if (!physical.conflicting) continue
    const targets = repositories
      .filter((repository) => repository.physicalPath === physical.path)
      .map((repository) => ({
        repository: repository.repository,
        desiredBranch: repository.desiredBranch,
      }))
    diagnostics.push(
      diagnostic(
        "ASTR7313",
        "error",
        `Environment ${environmentId} has conflicting branch targets in ${physical.path}: ${targets.map((target) => `${target.repository}=${target.desiredBranch ?? "<missing>"}`).join(", ")}`,
        {
          remediation:
            "Choose the same branch for members sharing a Git checkout, or use separate worktrees.",
          details: { path: physical.path, targets },
        },
      ),
    )
  }

  repositories.sort((left, right) => left.repository.localeCompare(right.repository))
  return {
    root: workspace.root,
    inputBindings: configBindingSnapshot(workspace.configs),
    configPath,
    environment: environmentId,
    configured: Boolean(environment.checkout && environment.repositories.length > 0),
    ...(desiredBranch ? { desiredBranch } : {}),
    repositories,
    physical: [...physicalByPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    diagnostics: uniqueDiagnostics(diagnostics),
  }
}

function statusFromObservation(observed: ObservedEnvironment): EnvironmentCheckoutStatus {
  return {
    environment: observed.environment,
    configured: observed.configured,
    ...(observed.desiredBranch ? { desiredBranch: observed.desiredBranch } : {}),
    consistent:
      observed.configured &&
      !hasErrors(observed.diagnostics) &&
      observed.repositories.length > 0 &&
      observed.repositories.every((repository) => repository.status === "matching"),
    repositories: observed.repositories,
  }
}

function emptyPlan(
  environment: string,
  root: string,
  diagnostics: Diagnostic[],
): EnvironmentCheckoutPlan {
  const planId = checkoutPlanId({ root, environment, actions: [] })
  return {
    operation: "environment-checkout",
    planId,
    root,
    configPath: `${root}/astrail.yaml`,
    environment,
    actions: [],
    diagnostics,
  }
}

function checkoutPlanId(value: unknown): string {
  return hash(stableStringify(value))
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
