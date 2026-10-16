import { spawn } from "node:child_process"
import { lstat, realpath } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import {
  discoverWorkspaceRoot,
  pathExists,
  type RuntimeMode,
  readRuntimePreference,
} from "astrail-core"
import { satisfies, valid } from "semver"
import { requireWorkspaceRuntime } from "./runtime-check.js"
import {
  ASTRAIL_PACKAGE,
  astrailDependency,
  installRemediation,
  isRecord,
  type PackageManifest,
  readPackage,
  workspacePackagePath,
} from "./workspace-package.js"

const DELEGATED_ENTRY = "ASTRAIL_DELEGATED_ENTRY"

export class LaunchUsageError extends Error {}

export interface LaunchOptions {
  cwd?: string
  config?: string
  json: boolean
  command: string
  runtime?: RuntimeMode
}

// Read only the routing options. The selected CLI owns command/option validation,
// including commands that a globally installed older CLI does not understand.
export function readLaunchOptions(args: string[]): LaunchOptions {
  const options: LaunchOptions = { json: false, command: "" }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] as string
    if (arg === "--") break
    if (arg === "--runtime" || arg.startsWith("--runtime=")) {
      const value = arg === "--runtime" ? args[++index] : arg.slice("--runtime=".length)
      if (value !== "global" && value !== "local")
        throw new LaunchUsageError("--runtime must be global or local")
      options.runtime = value
    } else if (arg === "--cwd" || arg === "--config") {
      const value = args[++index]
      if (!value || value.startsWith("-")) throw new LaunchUsageError(`${arg} requires a path`)
      options[arg === "--cwd" ? "cwd" : "config"] = value
    } else if (arg.startsWith("--cwd=")) {
      options.cwd = arg.slice("--cwd=".length)
    } else if (arg.startsWith("--config=")) {
      options.config = arg.slice("--config=".length)
    } else if (arg === "--json") {
      options.json = true
    } else if (!options.command && !arg.startsWith("-")) {
      options.command = arg
    }
  }
  return options
}

export async function selectLocalRuntime(
  options: LaunchOptions,
  currentEntry: string,
): Promise<string | undefined> {
  const cwd = resolve(options.cwd ?? process.cwd())
  let root: string
  let configPath: string
  if (options.command === "init") {
    // A new nested workspace must not inherit its parent's runtime.
    root = options.config ? dirname(resolve(cwd, options.config)) : cwd
    configPath = options.config ? resolve(cwd, options.config) : join(root, "astrail.yaml")
  } else {
    try {
      ;({ root, configPath } = await discoverWorkspaceRoot(cwd, options.config))
    } catch (error) {
      if (
        !options.config &&
        error instanceof Error &&
        error.message.startsWith("No astrail.yaml found from ")
      ) {
        return undefined
      }
      throw error
    }
  }

  if (options.runtime && options.command !== "init") {
    throw new LaunchUsageError(
      "--runtime is an init option; set runtime.mode in configuration for existing workspaces",
    )
  }
  const preference = options.runtime
    ? { mode: options.runtime }
    : await readRuntimePreference(root, configPath)
  const packageRoot = join(root, "node_modules", ...ASTRAIL_PACKAGE.split("/"))
  if (preference.mode === "global") {
    if (await isWorkspaceRuntime(root, currentEntry)) {
      throw new Error(
        "runtime.mode is global, but this is the workspace-local CLI. Run the globally installed astrail command instead of pnpm exec astrail.",
      )
    }
    return undefined
  }

  const manifest = (await readPackage(workspacePackagePath(root))) ?? {}
  const range = astrailDependency(manifest)
  const remediation = () => installRemediation(root, manifest)
  let present = false
  try {
    await lstat(packageRoot)
    present = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (!present) {
    if (preference.mode === "local" && options.command !== "init" && range === undefined) {
      throw new Error(
        `runtime.mode is local, but ${ASTRAIL_PACKAGE} is not installed. Add it to the workspace dependencies and install it in ${root}.`,
      )
    }
    if (range !== undefined && !(options.command === "init" && options.runtime === "local")) {
      throw new Error(
        `Workspace declares ${ASTRAIL_PACKAGE}@${range}, but it is not installed. ${remediation()}`,
      )
    }
    return undefined
  }

  // Resolve from the workspace's own node_modules, never from a child repository
  // or an unrelated ancestor that Node's usual package lookup might select.
  let local: PackageManifest | undefined
  try {
    local = await readPackage(join(packageRoot, "package.json"))
  } catch (error) {
    throw new Error(
      `Cannot read local ${ASTRAIL_PACKAGE} installation: ${error instanceof Error ? error.message : String(error)}. ${remediation()}`,
    )
  }
  if (
    local?.name !== ASTRAIL_PACKAGE ||
    typeof local.version !== "string" ||
    !valid(local.version)
  ) {
    throw new Error(`Invalid local ${ASTRAIL_PACKAGE} installation. ${remediation()}`)
  }
  if (range !== undefined && !satisfies(local.version, range)) {
    throw new Error(
      `Local ${ASTRAIL_PACKAGE}@${local.version} does not satisfy ${range}. ${remediation()}`,
    )
  }
  const bin =
    typeof local.bin === "string" ? local.bin : isRecord(local.bin) ? local.bin.astrail : undefined
  if (typeof bin !== "string" || !(await pathExists(resolve(packageRoot, bin)))) {
    throw new Error(`Local ${ASTRAIL_PACKAGE} executable is missing. ${remediation()}`)
  }
  const entry = await realpath(resolve(packageRoot, bin))
  // Check the selected local version, never the launcher's global version.
  // This also protects local releases that predate requirement enforcement.
  await requireWorkspaceRuntime(options, local.version)
  if (entry === (await realpath(currentEntry))) return undefined
  if (process.env[DELEGATED_ENTRY]) {
    throw new Error(`Recursive Astrail runtime delegation detected. ${remediation()}`)
  }
  return entry
}

export async function isWorkspaceRuntime(root: string, entry: string): Promise<boolean> {
  const packageRoot = await realpath(
    join(root, "node_modules", ...ASTRAIL_PACKAGE.split("/")),
  ).catch(() => undefined)
  if (!packageRoot) return false
  const path = relative(packageRoot, await realpath(entry))
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

export async function runLocalRuntime(entry: string, args: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      stdio: "inherit",
      env: { ...process.env, [DELEGATED_ENTRY]: entry },
    })
    const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const
    const handlers = signals.map((signal) => {
      const handler = () => {
        child.kill(signal)
      }
      process.on(signal, handler)
      return [signal, handler] as const
    })
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler)
    }
    child.once("error", (error) => {
      cleanup()
      reject(error)
    })
    child.once("exit", (code, signal) => {
      cleanup()
      if (signal) {
        // Preserve signal termination as well as ordinary numeric exit codes.
        process.kill(process.pid, signal)
      }
      resolveExit(code ?? 130)
    })
  })
}
