import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { valid, validRange } from "semver"

export const ASTRAIL_PACKAGE = "astrail"
export const DEFAULT_PNPM_VERSION = "11.20.0"

export type PackageManifest = Record<string, unknown>
export type PackageManager = "pnpm" | "npm" | "yarn"

export async function readPackage(path: string): Promise<PackageManifest | undefined> {
  let source: string
  try {
    source = await readFile(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
  const value: unknown = JSON.parse(source)
  if (!isRecord(value)) throw new Error(`Expected a JSON object in ${path}`)
  return value
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function astrailDependency(manifest: PackageManifest): string | undefined {
  let range: string | undefined
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const dependencies = manifest[field]
    if (dependencies === undefined) continue
    if (!isRecord(dependencies)) throw new Error(`package.json ${field} must be an object`)
    const declared = dependencies[ASTRAIL_PACKAGE]
    if (declared === undefined) continue
    if (typeof declared !== "string" || !validRange(declared) || declared.trim() === "") {
      throw new Error(`${ASTRAIL_PACKAGE} must declare a semver version range in ${field}`)
    }
    if (range !== undefined && range !== declared) {
      throw new Error(`Conflicting ${ASTRAIL_PACKAGE} dependency ranges in package.json`)
    }
    range = declared
  }
  return range
}

export function declaredPackageManager(
  manifest: PackageManifest,
): { name: PackageManager; version: string } | undefined {
  if (manifest.packageManager === undefined) return undefined
  if (typeof manifest.packageManager === "string") {
    const match = /^(pnpm|npm|yarn)@(.+)$/.exec(manifest.packageManager)
    // Corepack may append an integrity hash to the pinned version.
    const version = match?.[2]?.split("+")[0]
    if (match && version && valid(version)) {
      return { name: match[1] as PackageManager, version }
    }
  }
  throw new Error("packageManager must pin an exact pnpm, npm, or yarn version")
}

export function installRemediation(root: string, manifest: PackageManifest = {}): string {
  const manager = declaredPackageManager(manifest)?.name ?? "pnpm"
  return `Run ${manager} install in ${root} to install the declared workspace dependencies.`
}

export function workspacePackagePath(root: string): string {
  return join(root, "package.json")
}
