import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseDocument } from "yaml"

export type RuntimeMode = "global" | "local"

export interface RuntimePreference {
  mode: RuntimeMode | "auto"
  source?: string
}

export function userRuntimeConfigPath(): string {
  return process.env.ASTRAIL_USER_CONFIG
    ? resolve(process.env.ASTRAIL_USER_CONFIG)
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "astrail", "config.yaml")
}

// Runtime selection must precede command parsing and full config composition:
// a newer local CLI may understand fields that this launcher does not know.
// Only the workspace itself, its local overlay and user preferences can select
// an executable. Downloaded/shared configs cannot redirect the launcher.
export async function readRuntimePreference(
  root: string,
  configPath = join(root, "astrail.yaml"),
): Promise<RuntimePreference> {
  for (const path of [join(root, "astrail.local.yaml"), configPath, userRuntimeConfigPath()]) {
    const mode = await readRuntimeMode(path, path === userRuntimeConfigPath())
    if (mode) return { mode, source: path }
  }
  return { mode: "auto" }
}

export async function readRuntimeMode(
  path: string,
  userConfig = false,
): Promise<RuntimeMode | undefined> {
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  const document = parseDocument(text, { strict: true, uniqueKeys: true })
  if (document.errors.length) throw new Error(`Invalid runtime configuration YAML: ${path}`)
  const value: unknown = document.toJS({ maxAliasCount: 50 })
  if (!isRecord(value)) throw new Error(`Runtime configuration must be a mapping: ${path}`)
  if (userConfig && Object.keys(value).some((key) => key !== "runtime")) {
    throw new Error(`User configuration only supports runtime: ${path}`)
  }
  if (value.runtime === undefined) return undefined
  const runtime = value.runtime
  if (
    !isRecord(runtime) ||
    Object.keys(runtime).some((key) => key !== "mode") ||
    (runtime.mode !== "global" && runtime.mode !== "local")
  ) {
    throw new Error(`runtime.mode must be global or local: ${path}`)
  }
  return runtime.mode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
