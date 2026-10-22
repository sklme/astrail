import {
  type Diagnostic,
  type ResolvedWorkspace,
  type Result,
  result,
  stageGitCapability,
  type WorkspaceTransaction,
  withWorkspaceTransaction,
} from "astrail-core"
import {
  projectionManifestPath as codeBuddyManifestPath,
  doctorCodeBuddyProjection,
  planCodeBuddyProjection,
  syncCodeBuddyProjection,
} from "astrail-target-codebuddy"
import {
  projectionManifestPath as codexManifestPath,
  doctorCodexProjection,
  gitCapabilityResolutions,
  planCodexProjection,
  syncCodexProjection,
} from "astrail-target-codex"
import type {
  ProjectionPlan,
  ProjectionHealth as TargetProjectionHealth,
} from "astrail-target-shared"

type Target = "codex" | "codebuddy"
const adapters = {
  codex: {
    plan: planCodexProjection,
    sync: syncCodexProjection,
    doctor: doctorCodexProjection,
    manifest: codexManifestPath,
  },
  codebuddy: {
    plan: planCodeBuddyProjection,
    sync: syncCodeBuddyProjection,
    doctor: doctorCodeBuddyProjection,
    manifest: codeBuddyManifestPath,
  },
}
export interface WorkspaceProjectionPlan extends ProjectionPlan {
  targets: Partial<Record<Target, ProjectionPlan>>
}
export type ProjectionHealth = Partial<Record<Target, TargetProjectionHealth>>

function enabledTargets(workspace: ResolvedWorkspace): Target[] {
  return [
    ...new Set(
      Object.values(workspace.config.targets ?? {})
        .filter((entry) => entry && !entry.disabled)
        .map((entry) => entry.type)
        .filter((type) => Object.hasOwn(adapters, type)),
    ),
  ].sort() as Target[]
}

export async function planWorkspaceProjections(
  workspace: ResolvedWorkspace,
  options: { refreshGit?: boolean } = {},
): Promise<WorkspaceProjectionPlan> {
  const targets: WorkspaceProjectionPlan["targets"] = {}
  for (const target of enabledTargets(workspace))
    targets[target] = await adapters[target].plan(workspace, options)
  // An existing healthy target can pin a newly enabled target before a lock exists.
  // This matters when upgrading a workspace previously managed with legacy sync.
  if (!options.refreshGit) {
    const resolutions = new Map<string, ReturnType<typeof gitCapabilityResolutions>[number]>()
    for (const targetPlan of Object.values(targets)) {
      for (const resolution of gitCapabilityResolutions(targetPlan)) {
        if (!targetPlan.changes.some((change) => change.capability?.id === resolution.capabilityId))
          resolutions.set(resolution.capabilityId, resolution)
      }
    }
    let pinned = false
    const capabilities = workspace.capabilities.map((capability) => {
      const resolution = resolutions.get(capability.id)
      if (capability.source.type !== "git" || capability.lockedCommit || !resolution)
        return capability
      pinned = true
      return {
        ...capability,
        lockedCommit: resolution.resolvedCommit,
        integrity: resolution.integrity,
      }
    })
    if (pinned) {
      for (const target of enabledTargets(workspace))
        targets[target] = await adapters[target].plan({ ...workspace, capabilities }, options)
    }
  }
  return aggregate(workspace.root, targets, workspace.diagnostics)
}

function aggregate(
  root: string,
  targets: WorkspaceProjectionPlan["targets"],
  initial: Diagnostic[] = [],
): WorkspaceProjectionPlan {
  const plans = Object.values(targets)
  const base = targets.codex ?? plans[0]
  const diagnostics = [
    ...new Map(
      [...initial, ...plans.flatMap((plan) => plan.diagnostics)].map((d) => [JSON.stringify(d), d]),
    ).values(),
  ]
  return {
    root,
    strategy: base?.strategy ?? "link",
    agentsPath: base?.agentsPath ?? "",
    agentsContent: base?.agentsContent ?? "",
    targets,
    artifacts: plans.flatMap((plan) => plan.artifacts),
    changes: plans.flatMap((plan) => plan.changes),
    changePlan: {
      operation: "sync",
      actions: plans.flatMap((plan) => plan.changePlan.actions),
      diagnostics,
    },
    diagnostics,
  }
}

export async function syncWorkspaceProjections(
  plan: WorkspaceProjectionPlan,
  options: {
    dryRun?: boolean
    authorized?: boolean
    transaction?: WorkspaceTransaction
    acquire?: typeof stageGitCapability
  } = {},
): Promise<Result<WorkspaceProjectionPlan>> {
  if (options.dryRun || plan.diagnostics.some((d) => d.severity === "error"))
    return result(plan, plan.diagnostics)
  if (!options.transaction)
    return withWorkspaceTransaction(plan.root, (transaction) =>
      syncWorkspaceProjections(plan, { ...options, transaction }),
    )
  const stages = new Map<string, Awaited<ReturnType<typeof stageGitCapability>>>()
  const diagnostics = [...plan.diagnostics]
  try {
    const acquire: typeof stageGitCapability = async (capability, acquireOptions) => {
      const key = JSON.stringify([
        capability.identity,
        capability.source,
        capability.lockedCommit,
        capability.integrity,
      ])
      let staged = stages.get(key)
      if (!staged) {
        staged = await (options.acquire ?? stageGitCapability)(capability, acquireOptions)
        stages.set(key, staged)
      }
      return { ...staged, cleanup: async () => {} }
    }
    for (const [id, targetPlan] of Object.entries(plan.targets)) {
      const adapter = adapters[id as Target]
      await options.transaction?.capture([
        ...targetPlan.changePlan.actions.map((action) => action.target),
        adapter.manifest(plan.root),
      ])
      const synced = await adapter.sync(targetPlan, {
        authorized: options.authorized === true,
        acquire,
      })
      diagnostics.push(...synced.diagnostics)
      if (!synced.success) break
    }
    const combined = aggregate(plan.root, plan.targets, diagnostics)
    return result(combined, combined.diagnostics)
  } finally {
    for (const stage of stages.values()) await stage.cleanup()
  }
}

export async function doctorWorkspaceProjections(workspace: ResolvedWorkspace) {
  const projections: ProjectionHealth = {}
  const diagnostics: Diagnostic[] = []
  for (const target of enabledTargets(workspace)) {
    const health = await adapters[target].doctor(workspace)
    projections[target] = health.data
    diagnostics.push(...health.diagnostics)
  }
  const codex: TargetProjectionHealth = projections.codex ?? {
    manifestPresent: false,
    current: true,
    artifacts: [],
    pendingActions: [],
  }
  return result({ projections, codex }, diagnostics)
}

export function workspaceGitResolutions(plan: WorkspaceProjectionPlan) {
  return [
    ...new Map(gitCapabilityResolutions(plan).map((entry) => [entry.capabilityId, entry])).values(),
  ]
}
