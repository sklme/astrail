import { lstat, realpath, stat } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { acquireOperationLock, atomicWrite, isNodeError, readTextIfExists } from "./fs.js"
import type { ChangeAction } from "./lifecycle.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedWorkspace,
  type Result,
  result,
} from "./types.js"

export const EDITOR_IDS = ["vscode", "cursor", "codebuddy"] as const
export type EditorId = (typeof EDITOR_IDS)[number]
export const DEFAULT_WORKSPACE_FILE = "astrail.code-workspace"
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]*\.code-workspace$/
const STATE_FILE = ".astrail/editor-workspace.json"

type WorkspaceInput = Pick<ResolvedWorkspace, "root" | "config" | "topology" | "diagnostics">
export interface EditorFolder {
  name: string
  path: string
}
interface OwnershipState {
  version: 1
  files: Record<string, EditorFolder[]>
}
export interface EditorFileEdit {
  path: string
  before: string | undefined
  after: string
}
export interface EditorWorkspacePlan {
  root: string
  workspacePath: string
  folders: EditorFolder[]
  skipped: Array<{ repository: string; reason: "missing" | "covered"; path?: string }>
  files: EditorFileEdit[]
  actions: ChangeAction[]
  diagnostics: Diagnostic[]
}
export interface EditorWorkspaceData {
  root: string
  workspacePath: string
  synchronized: boolean
  changed: boolean
  plan: EditorWorkspacePlan
}

export async function planEditorWorkspace(workspace: WorkspaceInput): Promise<EditorWorkspacePlan> {
  const filename = workspace.config.editor?.workspaceFile ?? defaultWorkspaceFile(workspace)
  const diagnostics = [...workspace.diagnostics]
  const plan: EditorWorkspacePlan = {
    root: workspace.root,
    workspacePath: join(workspace.root, DEFAULT_WORKSPACE_FILE),
    folders: [],
    skipped: [],
    files: [],
    actions: [],
    diagnostics,
  }
  if (!FILE_NAME.test(filename) || !filename.endsWith(".code-workspace")) {
    diagnostics.push(
      diagnostic("ASTR7401", "error", "Invalid editor workspace filename", {
        remediation: "Set editor.workspaceFile to a root-level filename ending in .code-workspace.",
      }),
    )
    return plan
  }
  plan.workspacePath = join(workspace.root, filename)
  if (diagnostics.some((item) => item.severity === "error")) return plan
  try {
    const candidates: Array<{ id: string; path: string; physical: string }> = []
    for (const repository of workspace.topology.repositories) {
      const path = repository.path
      let present = false
      if (path) {
        try {
          present = (await stat(path)).isDirectory()
        } catch (error) {
          if (!isNodeError(error) || !["ENOENT", "ENOTDIR"].includes(error.code ?? "")) throw error
        }
      }
      if (!path || !present) {
        plan.skipped.push({
          repository: repository.id,
          reason: "missing",
          ...(path ? { path } : {}),
        })
        diagnostics.push(
          diagnostic(
            "ASTR7402",
            "warning",
            `Editor skipped unavailable repository ${repository.id}`,
            {
              remediation:
                "Prepare the repository or fix its local path, then run astrail editor sync.",
            },
          ),
        )
        continue
      }
      candidates.push({ id: repository.id, path, physical: await realpath(path) })
    }
    // Sort shallow roots first, with stable IDs breaking ties for identical physical paths.
    candidates.sort(
      (a, b) =>
        a.physical.split(sep).length - b.physical.split(sep).length || a.id.localeCompare(b.id),
    )
    const selected: typeof candidates = []
    for (const candidate of candidates) {
      if (selected.some((parent) => containsPath(parent.physical, candidate.physical))) {
        plan.skipped.push({ repository: candidate.id, reason: "covered", path: candidate.path })
      } else selected.push(candidate)
    }
    const desired = selected
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, path }) => ({
        name: id,
        path: portablePath(workspace.root, path),
      }))
    await assertRegularDestination(workspace.root, STATE_FILE)
    await assertRegularDestination(workspace.root, filename)
    await assertRegularDestination(workspace.root, ".gitignore")
    const statePath = join(workspace.root, STATE_FILE)
    const stateBefore = await readTextIfExists(statePath)
    const state = readState(stateBefore)
    const before = await readTextIfExists(plan.workspacePath)
    let source = before
    let previous = state.files[filename] ?? []
    // Carry forward a managed legacy workspace without deleting or rewriting it.
    if (
      source === undefined &&
      workspace.config.editor?.workspaceFile === undefined &&
      filename !== DEFAULT_WORKSPACE_FILE &&
      state.files[DEFAULT_WORKSPACE_FILE] !== undefined
    ) {
      await assertRegularDestination(workspace.root, DEFAULT_WORKSPACE_FILE)
      const path = join(workspace.root, DEFAULT_WORKSPACE_FILE)
      const legacy = await readTextIfExists(path)
      if (legacy !== undefined) {
        source = legacy
        previous = state.files[DEFAULT_WORKSPACE_FILE] ?? []
        plan.files.push({ path, before: legacy, after: legacy })
      }
    }
    let content = source ?? '{\n  "folders": []\n}\n'
    const document = parseObject(content)
    if (
      document.folders !== undefined &&
      (!Array.isArray(document.folders) || !document.folders.every(validFolder))
    ) {
      throw new Error("Workspace folders must be an array of path or URI folder objects")
    }
    const original = (document.folders ?? []) as Record<string, unknown>[]
    const owned: EditorFolder[] = []
    const preserved = [...original]
    // Edit only removed owned entries; do not rewrite the entire folders array or user settings.
    for (let index = original.length - 1; index >= 0; index -= 1) {
      const folder = original[index]
      if (!folder || !previous.some((entry) => equalFolder(folder, entry))) continue
      const wanted = desired.find((entry) => equalFolder(folder, entry))
      if (wanted) owned.push(wanted)
      else {
        content = edit(content, ["folders", index], undefined)
        preserved.splice(index, 1)
      }
    }
    if (document.folders === undefined) content = edit(content, ["folders"], [])
    for (const folder of desired) {
      if (
        preserved.some(
          (entry) =>
            typeof entry.path === "string" &&
            resolve(workspace.root, entry.path) === resolve(workspace.root, folder.path),
        )
      )
        continue
      content = edit(content, ["folders", -1], folder)
      preserved.push({ ...folder })
      owned.push(folder)
    }
    plan.folders = desired
    state.files[filename] = owned.sort((a, b) => a.name.localeCompare(b.name))
    const ignorePath = join(workspace.root, ".gitignore")
    const ignoreBefore = await readTextIfExists(ignorePath)
    let ignore = ignoreBefore ?? ""
    for (const entry of [`/${filename}`, `/${STATE_FILE}`]) {
      if (!ignore.split(/\r?\n/).includes(entry))
        ignore += `${ignore && !ignore.endsWith("\n") ? "\n" : ""}${entry}\n`
    }
    for (const file of [
      { path: ignorePath, before: ignoreBefore, after: ignore },
      { path: plan.workspacePath, before, after: content },
      { path: statePath, before: stateBefore, after: `${JSON.stringify(state, null, 2)}\n` },
    ]) {
      // Retain unchanged reads too: they participate in stale-plan detection.
      plan.files.push(file)
      if (file.before !== file.after)
        plan.actions.push({
          id: `editor:${relative(workspace.root, file.path)}`,
          type: "write",
          target: file.path,
          description: `Synchronize ${relative(workspace.root, file.path)}`,
          requiresAuthorization: false,
        })
    }
  } catch (error) {
    diagnostics.push(
      diagnostic("ASTR7403", "error", `Cannot prepare editor workspace: ${errorMessage(error)}`, {
        remediation:
          "Repair the workspace JSONC, ownership state, or unsafe destination; then run astrail editor sync --dry-run.",
      }),
    )
  }
  return plan
}

export async function applyEditorWorkspace(
  plan: EditorWorkspacePlan,
  options: { dryRun?: boolean } = {},
): Promise<Result<EditorWorkspaceData>> {
  const data: EditorWorkspaceData = {
    root: plan.root,
    workspacePath: plan.workspacePath,
    synchronized: false,
    changed: false,
    plan,
  }
  if (options.dryRun || plan.diagnostics.some((item) => item.severity === "error"))
    return result(data, plan.diagnostics)
  let lock: Awaited<ReturnType<typeof acquireOperationLock>> | undefined
  try {
    await assertStateDirectory(plan.root)
    lock = await acquireOperationLock(plan.root)
    for (const file of plan.files) {
      const local = relative(plan.root, file.path).split(sep).join("/")
      if (![".gitignore", STATE_FILE].includes(local) && !FILE_NAME.test(local))
        throw new Error("Editor plan contains an invalid destination")
      await assertRegularDestination(plan.root, local)
      if ((await readTextIfExists(file.path)) !== file.before) {
        return result(data, [
          ...plan.diagnostics,
          diagnostic("ASTR7404", "error", "Editor files changed after preview", {
            remediation: "Run astrail editor sync --dry-run again before retrying.",
          }),
        ])
      }
    }
    for (const file of plan.files) {
      if (file.before !== file.after) {
        await atomicWrite(file.path, file.after)
        data.changed = true
      }
    }
    data.synchronized = true
    return result(data, plan.diagnostics)
  } catch (error) {
    return result(data, [
      ...plan.diagnostics,
      diagnostic("ASTR7405", "error", `Editor synchronization failed: ${errorMessage(error)}`, {
        remediation:
          "Check destination permissions and retry astrail editor sync; already completed repository work is retained.",
      }),
    ])
  } finally {
    await lock?.release()
  }
}

export async function syncEditorWorkspace(
  workspace: WorkspaceInput,
  options: { dryRun?: boolean } = {},
): Promise<Result<EditorWorkspaceData>> {
  return applyEditorWorkspace(await planEditorWorkspace(workspace), options)
}

function defaultWorkspaceFile(workspace: WorkspaceInput): string {
  for (const name of [workspace.config.metadata?.name, basename(workspace.root)]) {
    if (name && FILE_NAME.test(`${name}.code-workspace`)) return `${name}.code-workspace`
  }
  return DEFAULT_WORKSPACE_FILE
}

function edit(content: string, path: (string | number)[], value: unknown): string {
  return applyEdits(
    content,
    modify(content, path, value, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: content.includes("\r\n") ? "\r\n" : "\n",
      },
    }),
  )
}
function parseObject(text: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const value: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !isRecord(value)) throw new Error("Invalid JSONC object")
  return value
}
function readState(text: string | undefined): OwnershipState {
  if (text === undefined) return { version: 1, files: {} }
  const value = parseObject(text)
  if (
    value.version !== 1 ||
    !isRecord(value.files) ||
    !Object.entries(value.files).every(
      ([name, folders]) =>
        FILE_NAME.test(name) &&
        Array.isArray(folders) &&
        folders.every(
          (folder) =>
            isRecord(folder) && typeof folder.name === "string" && typeof folder.path === "string",
        ),
    )
  )
    throw new Error("Invalid editor ownership state")
  return value as unknown as OwnershipState
}
function validFolder(value: unknown): boolean {
  return isRecord(value) && (typeof value.path === "string" || typeof value.uri === "string")
}
function equalFolder(value: Record<string, unknown>, folder: EditorFolder): boolean {
  return Object.keys(value).length === 2 && value.name === folder.name && value.path === folder.path
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function containsPath(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`))
}
function portablePath(root: string, path: string): string {
  const local = relative(root, path)
  return (isAbsolute(local) ? path : local || ".").split(sep).join("/")
}
async function assertStateDirectory(root: string): Promise<void> {
  try {
    const info = await lstat(join(root, ".astrail"))
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(".astrail must be a real directory")
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
  }
}
async function assertRegularDestination(root: string, local: string): Promise<void> {
  if (local === STATE_FILE) await assertStateDirectory(root)
  try {
    const info = await lstat(join(root, local))
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error(`${local} must be a regular file, not a symlink`)
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error
  }
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
