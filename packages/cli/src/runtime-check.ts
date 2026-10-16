import { resolve } from "node:path"
import {
  type AstrailRuntimeCompatibility,
  discoverWorkspaceRoot,
  inspectWorkspaceRuntime,
  pathExists,
  type Result,
} from "astrail-core"

export class RuntimeCompatibilityError extends Error {
  constructor(readonly inspection: Result<{ root: string; runtime: AstrailRuntimeCompatibility }>) {
    super(inspection.diagnostics.map((item) => item.message).join("; "))
  }
}

export async function requireWorkspaceRuntime(
  options: { cwd?: string; config?: string; command: string },
  version: string,
): Promise<void> {
  let configPath: string
  if (options.command === "init") {
    configPath = resolve(options.cwd ?? process.cwd(), options.config ?? "astrail.yaml")
    if (!(await pathExists(configPath))) return
  } else {
    try {
      configPath = (await discoverWorkspaceRoot(options.cwd, options.config)).configPath
    } catch (error) {
      if (
        !options.config &&
        error instanceof Error &&
        error.message.startsWith("No astrail.yaml found from ")
      )
        return
      throw error
    }
  }
  const inspection = await inspectWorkspaceRuntime({ config: configPath, astrailVersion: version })
  if (!inspection.success) throw new RuntimeCompatibilityError(inspection)
}
