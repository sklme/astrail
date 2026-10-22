import { resolve } from "node:path"
import {
  acquireConfigs,
  applyBootstrap,
  applyFilePlan,
  type ChangePlan,
  type ConfigSetupEntry,
  configCacheRoot,
  type Diagnostic,
  diagnostic,
  discoverRepositorySkills,
  type EditorWorkspaceData,
  isFixedConfigReference,
  journalSkipStep,
  journalStep,
  loadWorkspace,
  pathExists,
  planBootstrap,
  planLock,
  planUpdate,
  type RepositorySkillInventory,
  type ResolvedWorkspace,
  type Result,
  resolveWorkspace,
  result,
  summarizeRepositorySkillDiscovery,
  syncEditorWorkspace,
  type WorkspaceTransaction,
  withWorkspaceTransaction,
} from "astrail-core"
import {
  planWorkspaceProjections,
  syncWorkspaceProjections,
  workspaceGitResolutions,
} from "./projections.js"

interface InstallContext {
  cwd?: string
  config?: string
}
interface InstallOptions {
  dryRun?: boolean
  yes?: boolean
  update?: boolean
}

export async function installWorkspace(
  context: InstallContext,
  options: InstallOptions = {},
): Promise<Result<WorkspaceInstallData>> {
  const loaded = await loadWorkspace({ ...context, install: true })
  const run = (transaction?: WorkspaceTransaction) => runInstall(context, options, transaction)
  if (options.dryRun) return run()
  const installed = await withWorkspaceTransaction(loaded.root, run)
  if (!installed.success) {
    installed.data.rolledBack = true
    installed.data.setup = installed.data.setup.map(({ instruction: _, ...entry }) => ({
      ...entry,
      status: "blocked",
    }))
  }
  return installed
}

async function runInstall(
  context: InstallContext,
  options: InstallOptions,
  transaction?: WorkspaceTransaction,
): Promise<Result<WorkspaceInstallData>> {
  const resolution = {
    ...context,
    install: true,
    observe: true,
    ignoreLock: options.update === true,
  }
  let workspace = await resolveWorkspace(resolution)
  const original = options.update
    ? await resolveWorkspace({ ...context, install: true })
    : workspace
  const plans: ChangePlan[] = []
  const diagnostics: Diagnostic[] = []
  const inventory = await inspectInstalledRepositorySkills(resolution)
  const data: WorkspaceInstallData = {
    root: workspace.root,
    bootstrap: plans,
    repositorySkills: inventory.inventory,
    setup: [],
  }
  const finish = async () => {
    data.setup = await configSetupHandoff(
      workspace,
      data.projection,
      options.dryRun === true,
      !diagnostics.some((item) => item.severity === "error"),
    )
    // Updating dependencies does not request repeating existing setup procedures.
    if (options.update) data.setup = data.setup.map(({ instruction: _, ...entry }) => entry)
    return result(data, uniqueDiagnostics(diagnostics))
  }

  if (options.update) {
    const initialPlan = await planBootstrap(workspace)
    if (initialPlan.diagnostics.some((item) => item.severity === "error")) {
      diagnostics.push(...initialPlan.diagnostics)
      return finish()
    }
    // Refresh parents before their old dependencies, resolving again after each
    // checkout. This avoids fetching dependencies removed by the new parent.
    const refreshed = new Set<string>()
    for (let attempt = 0; attempt < 512; attempt += 1) {
      const remote = [...workspace.configs]
        .reverse()
        .filter((config) => config.source.type !== "local")
      for (const config of remote) {
        const locked = original.configs.find((item) => item.key === config.key)
        if (
          config.available &&
          (!locked?.expectedCommit || locked.expectedCommit === config.resolvedCommit) &&
          (!locked?.expectedIntegrity || locked.expectedIntegrity === config.integrity) &&
          (await isFixedConfigReference(workspace.root, config))
        )
          refreshed.add(configCacheRoot(workspace.root, config.source))
      }
      const pending = remote.filter(
        (config) => !refreshed.has(configCacheRoot(workspace.root, config.source)),
      )
      if (!pending.length) break
      const selected = options.dryRun ? pending : pending.slice(0, 1)
      const plan: ChangePlan = {
        operation: "update",
        diagnostics: [],
        actions: selected.map((config) => ({
          id: `refresh-config:${config.key}`,
          type: "acquire",
          target: configCacheRoot(workspace.root, config.source),
          requiresAuthorization: true,
          description: `Check and refresh shared config ${config.source.type === "local" ? config.source.path : config.source.url}`,
          details: {
            source: config.source,
            ...(config.resolvedCommit ? { before: config.resolvedCommit } : {}),
          },
        })),
      }
      plans.push(plan)
      if (options.dryRun) {
        diagnostics.push(
          diagnostic(
            "ASTR6210",
            "information",
            "Remote revisions and nested dependency changes are determined during authorized update; this preview does not contact remotes.",
          ),
        )
        break
      }
      if (!options.yes) {
        diagnostics.push(
          diagnostic("ASTR6201", "error", "Remote dependency updates require authorization", {
            remediation: "Review astrail update --dry-run, then run astrail update --yes.",
          }),
        )
        return finish()
      }
      const config = pending[0]
      if (!config) break
      const target = configCacheRoot(workspace.root, config.source)
      await transaction?.capture([target])
      const lockedCommit = original.configs.find((item) => item.key === config.key)?.expectedCommit
      diagnostics.push(
        ...(await acquireConfigs(workspace.root, [config], workspace.runtime.version, {
          refresh: true,
          ...(lockedCommit ? { lockedCommit } : {}),
        })),
      )
      if (diagnostics.some((item) => item.severity === "error")) return finish()
      refreshed.add(target)
      workspace = await resolveWorkspace(resolution)
      if (attempt === 511)
        diagnostics.push(
          diagnostic("ASTR6107", "error", "Update exceeded the config acquisition limit"),
        )
    }
  }

  for (let attempt = 0; attempt < 66; attempt += 1) {
    const plan = await planBootstrap(workspace)
    plans.push(plan)
    await transaction?.capture(
      plan.actions
        .filter((action) => Array.isArray(action.details?.configs))
        .map((action) => action.target),
    )
    const applied = await applyBootstrap(workspace, plan, {
      dryRun: options.dryRun === true,
      authorized: options.yes === true,
    })
    diagnostics.push(...applied.diagnostics)
    const hasAcquisition = plan.actions.some(
      (action) => action.type === "clone" || action.type === "acquire",
    )
    if (!applied.success || options.dryRun || !hasAcquisition) break
    workspace = await resolveWorkspace(resolution)
    if (attempt === 65)
      diagnostics.push(
        diagnostic("ASTR6107", "error", "Install exceeded the config acquisition limit"),
      )
  }
  if (
    diagnostics.some((item) => item.severity === "error") ||
    workspace.configs.some((config) => !config.available)
  ) {
    journalSkipStep("projection.sync", "blocked")
    journalSkipStep("editor.sync", "blocked")
    diagnostics.push(...workspace.diagnostics)
    return finish()
  }
  if (!options.dryRun) workspace = await resolveWorkspace(resolution)
  if (options.update) {
    for (const capability of workspace.capabilities) {
      if (capability.source.type !== "git" || capability.source.revision.branch) continue
      const previous = original.capabilities.find(
        (item) =>
          item.id === capability.id &&
          item.identity === capability.identity &&
          JSON.stringify(item.source) === JSON.stringify(capability.source),
      )
      if (previous?.lockedCommit) capability.lockedCommit = previous.lockedCommit
      if (previous?.integrity && !capability.integrity) capability.integrity = previous.integrity
    }
  }
  const projection = await planWorkspaceProjections(workspace, {
    refreshGit: options.update === true,
  })
  const synced = await syncWorkspaceProjections(projection, {
    dryRun: options.dryRun === true,
    authorized: options.yes === true,
    ...(transaction ? { transaction } : {}),
  })
  data.projection = synced.data
  diagnostics.push(...workspace.diagnostics, ...synced.diagnostics)
  if (!synced.success) {
    journalSkipStep("editor.sync", "blocked")
    return finish()
  }

  const editorPreview = await syncEditorWorkspace(workspace, { dryRun: true })
  await transaction?.capture(editorPreview.data.plan.actions.map((action) => action.target))
  const editor =
    options.dryRun || !editorPreview.success ? editorPreview : await syncEditorWorkspace(workspace)
  data.editorWorkspace = editor.data
  diagnostics.push(...editor.diagnostics)
  if (!editor.success) return finish()

  const lock = await (options.update ? planUpdate : planLock)(workspace, {
    acquisitions: workspaceGitResolutions(synced.data),
  })
  await transaction?.capture(lock.actions.map((action) => action.target))
  const locked = await applyFilePlan(workspace.root, lock, { dryRun: options.dryRun === true })
  data.lock = locked.data
  diagnostics.push(...locked.diagnostics)
  const discovered = await journalStep("skill.discover", () =>
    inspectInstalledRepositorySkills(resolution),
  )
  data.repositorySkills = discovered.inventory
  diagnostics.push(...discovered.diagnostics)
  return finish()
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...new Map(diagnostics.map((item) => [JSON.stringify(item), item])).values()]
}
export interface WorkspaceInstallData {
  editorWorkspace?: EditorWorkspaceData
  root: string
  lock?: ChangePlan
  rolledBack?: boolean
  bootstrap: ChangePlan[]
  projection?: Awaited<ReturnType<typeof syncWorkspaceProjections>>["data"]
  repositorySkills: RepositorySkillInventory
  setup: CliConfigSetupEntry[]
}

interface CliConfigSetupEntry extends Omit<ConfigSetupEntry, "status"> {
  status: "blocked" | "planned" | "available"
  path?: string
  instruction?: string
}

export const SETUP_HANDOFF_INSTRUCTION =
  "As part of the requested Workspace initialization, read the SKILL.md at path and complete its setup now, in output order, without asking for a separate setup request. Check existing configuration first. Report unresolved login, credentials, or other prerequisites as unfinished initialization; availability does not prove completed setup or authentication."

async function configSetupHandoff(
  workspace: ResolvedWorkspace,
  projection?: WorkspaceInstallData["projection"],
  dryRun = false,
  success = false,
): Promise<CliConfigSetupEntry[]> {
  return Promise.all(
    workspace.configSetups.map(async (entry): Promise<CliConfigSetupEntry> => {
      if (entry.status !== "pending") return { ...entry, status: entry.status }
      const artifact = projection?.artifacts.find(
        (item) => item.identity === entry.skill && item.ownership !== "manifest-entry",
      )
      const path = artifact ? resolve(workspace.root, artifact.path, "SKILL.md") : undefined
      const status = !path
        ? "blocked"
        : dryRun
          ? "planned"
          : success && (await pathExists(path))
            ? "available"
            : "blocked"
      return {
        ...entry,
        status,
        ...(path ? { path } : {}),
        ...(status === "available" ? { instruction: SETUP_HANDOFF_INSTRUCTION } : {}),
      }
    }),
  )
}

async function inspectInstalledRepositorySkills(
  context: InstallContext & { install?: boolean; ignoreLock?: boolean },
): Promise<{
  inventory: RepositorySkillInventory
  diagnostics: Diagnostic[]
}> {
  const discovery = await discoverRepositorySkills({ all: true }, context)
  const inventory = summarizeRepositorySkillDiscovery(discovery)
  const diagnostics = discovery.diagnostics.filter((item) => item.severity === "error")
  if (inventory.unimported > 0) {
    diagnostics.push(
      diagnostic(
        "ASTR6105",
        "information",
        `Install found ${inventory.unimported} repository Skill${inventory.unimported === 1 ? "" : "s"} that ${inventory.unimported === 1 ? "is" : "are"} not imported`,
        {
          remediation:
            "Review astrail skill discover --all, selectively import with astrail skill import, then preview astrail install --dry-run.",
          details: { repositorySkills: inventory },
        },
      ),
    )
  }
  return { inventory, diagnostics }
}
