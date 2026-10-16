import { spawn } from "node:child_process"
import { constants } from "node:fs"
import { access, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join, resolve } from "node:path"
import {
  diagnostic,
  EDITOR_IDS,
  type EditorId,
  type EditorWorkspaceData,
  type ResolvedWorkspace,
  type Result,
  result,
  syncEditorWorkspace,
} from "astrail-core"

export const EDITOR_CAPABILITY = {
  id: "astrail-editor",
  kind: "builtin-command",
  skill: "astrail-editor",
  description: "Synchronize and open all repository roots in VS Code, Cursor, or CodeBuddy IDE",
  discovery: "astrail --json editor list",
  preview: "astrail --json open --editor <editor> --dry-run",
  execute: "astrail --json open --editor <editor>",
  sync: "astrail --json editor sync",
  editors: EDITOR_IDS,
}

export interface EditorLaunch {
  editor: EditorId
  executable: string
  args: string[]
  available: boolean
  status: "planned" | "dispatched" | "failed"
}
export interface EditorOpenData extends EditorWorkspaceData {
  launch: EditorLaunch | null
}
export interface EditorDependencies {
  platform?: NodeJS.Platform
  home?: string
  path?: string
  isExecutable?: (path: string) => Promise<boolean>
  launch?: (
    executable: string,
    args: string[],
    cwd: string,
  ) => Promise<{ exitCode: number | null; error?: string }>
}

export async function resolveEditorLaunch(
  workspace: ResolvedWorkspace,
  editor: EditorId,
  workspacePath: string,
  dependencies: EditorDependencies = {},
): Promise<EditorLaunch> {
  const platform = dependencies.platform ?? process.platform
  // Cursor can default to the Agents window; explicitly request its code editor.
  const args = editor === "cursor" ? ["--classic", workspacePath] : [workspacePath]
  const executable = workspace.config.editor?.executables?.[editor]
  const check = dependencies.isExecutable ?? isExecutable
  const candidates = executable
    ? [
        executable.includes("/") || executable.includes("\\")
          ? resolve(workspace.root, executable)
          : executable,
      ]
    : defaultCandidates(editor, platform, dependencies.home ?? homedir())
  for (const candidate of candidates) {
    const found = await findExecutable(
      candidate,
      platform,
      dependencies.path ?? process.env.PATH ?? "",
      check,
    )
    if (found)
      return {
        editor,
        executable: found,
        args,
        available: true,
        status: "planned",
      }
  }
  return {
    editor,
    executable: candidates[0] ?? editor,
    args,
    available: false,
    status: "planned",
  }
}

export async function openEditor(
  workspace: ResolvedWorkspace,
  options: { editor?: string; dryRun?: boolean },
  dependencies: EditorDependencies = {},
): Promise<Result<EditorOpenData>> {
  const selected = options.editor ?? workspace.config.editor?.default ?? "vscode"
  if (!EDITOR_IDS.includes(selected as EditorId)) {
    const preview = await syncEditorWorkspace(workspace, { dryRun: true })
    return result({ ...preview.data, launch: null }, [
      ...preview.diagnostics,
      diagnostic("ASTR7410", "error", `Unsupported editor: ${selected}`, {
        remediation:
          "Choose vscode, cursor, or codebuddy. Run astrail --json editor list for discovery.",
      }),
    ])
  }
  const synced = await syncEditorWorkspace(workspace, options)
  const data: EditorOpenData = { ...synced.data, launch: null }
  if (!synced.success) return result(data, synced.diagnostics)
  const launch = await resolveEditorLaunch(
    workspace,
    selected as EditorId,
    synced.data.workspacePath,
    dependencies,
  )
  data.launch = launch
  const remediation = `Install the ${selected} IDE launcher or set editor.executables.${selected} to its executable path in astrail.local.yaml. CodeBuddy requires the IDE launcher, not the codebuddy terminal Agent.`
  if (!launch.available) {
    launch.status = options.dryRun ? "planned" : "failed"
    return result(data, [
      ...synced.diagnostics,
      diagnostic(
        "ASTR7411",
        options.dryRun ? "warning" : "error",
        `Editor launcher unavailable: ${launch.executable}`,
        { remediation },
      ),
    ])
  }
  if (options.dryRun) return result(data, synced.diagnostics)
  try {
    const launched = await (dependencies.launch ?? launchEditorProcess)(
      launch.executable,
      launch.args,
      workspace.root,
    )
    if (launched.error || (launched.exitCode !== 0 && launched.exitCode !== null))
      throw new Error(launched.error ?? `Launcher exited with code ${launched.exitCode}`)
    launch.status = "dispatched"
    return result(data, synced.diagnostics)
  } catch (error) {
    launch.status = "failed"
    return result(data, [
      ...synced.diagnostics,
      diagnostic(
        "ASTR7412",
        "error",
        `Editor launch failed: ${error instanceof Error ? error.message : String(error)}`,
        { remediation },
      ),
    ])
  }
}

export function renderEditorWorkspace(data: EditorWorkspaceData): string {
  return [
    `${data.synchronized ? "Synchronized" : "Planned"} editor workspace: ${data.workspacePath}`,
    `${data.plan.folders.length} repository roots; ${data.plan.skipped.length} skipped.`,
    ...data.plan.actions.map((action) => action.description),
    "Open all repositories with astrail open, or ask your agent to open them in VS Code, Cursor, or CodeBuddy.",
  ].join("\n")
}
export function renderEditorOpen(data: EditorOpenData): string {
  return `${renderEditorWorkspace(data)}${data.launch ? `\n${data.launch.editor}: ${data.launch.status} (${data.launch.executable})` : ""}`
}

function defaultCandidates(editor: EditorId, platform: NodeJS.Platform, home: string): string[] {
  const commands =
    platform === "win32"
      ? {
          vscode: ["Code.exe"],
          cursor: ["Cursor.exe"],
          codebuddy: ["CodeBuddy CN.exe", "CodeBuddy.exe"],
        }
      : { vscode: ["code"], cursor: ["cursor"], codebuddy: ["buddycn", "buddy"] }
  if (platform !== "darwin") return commands[editor]
  const apps = {
    vscode: ["Visual Studio Code.app"],
    cursor: ["Cursor.app"],
    codebuddy: ["CodeBuddy CN.app", "CodeBuddy.app"],
  }
  return [
    ...["/Applications", join(home, "Applications")].flatMap((base) =>
      apps[editor].map((app) => join(base, app, "Contents/Resources/app/bin/code")),
    ),
    ...commands[editor],
  ]
}
async function findExecutable(
  candidate: string,
  platform: NodeJS.Platform,
  path: string,
  check: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (isAbsolute(candidate)) return (await check(candidate)) ? candidate : undefined
  const dirs = path.split(platform === "win32" ? ";" : delimiter).filter(Boolean)
  for (const directory of dirs) {
    const target = join(directory, candidate)
    if (await check(target)) return target
  }
  return undefined
}
async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK)
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

// IDE shell launchers normally exit quickly; direct GUI executables can stay alive.
// Report dispatch after a bounded wait, without keeping Astrail attached to the GUI.
export function launchEditorProcess(
  executable: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number | null; error?: string }> {
  return new Promise((accept) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: "ignore",
      detached: true,
      windowsHide: true,
    })
    let settled = false
    const finish = (value: { exitCode: number | null; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.unref()
      accept(value)
    }
    const timer = setTimeout(() => finish({ exitCode: null }), 2000)
    child.once("error", (error) => finish({ exitCode: 1, error: error.message }))
    child.once("exit", (code, signal) =>
      finish(
        signal ? { exitCode: 1, error: `Launcher terminated by ${signal}` } : { exitCode: code },
      ),
    )
  })
}
