import { readFileSync } from "node:fs"
import { satisfies, valid, validRange } from "semver"
import { type Diagnostic, diagnostic, type Result, result, type SourceLocation } from "./types.js"

// Core and CLI packages are released in one fixed version group.
export const ASTRAIL_ENGINE_VERSION = String(
  (
    JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string
    }
  ).version,
)

export interface AstrailRequirement {
  source: string
  pointer: string
  range: string
  supported: boolean
}

export interface AstrailRuntimeCompatibility {
  version: string
  supported: boolean
  requirements: AstrailRequirement[]
}

export function isRuntimeRequirementDiagnostic(item: Diagnostic): boolean {
  return item.code === "ASTR1201" || item.code === "ASTR1202"
}

export function inspectAstrailRequirement(
  manifest: Record<string, unknown>,
  source: string,
  version = ASTRAIL_ENGINE_VERSION,
  locations: Record<string, SourceLocation> = {},
  prefix = "",
): Result<AstrailRequirement | undefined> {
  if (manifest.requires === undefined) return result(undefined)
  const pointer = `${prefix}/requires/astrail`
  const location = locations[pointer] ??
    locations[`${prefix}/requires`] ?? {
      file: source,
      line: 1,
      column: 1,
      pointer,
    }
  const requires = manifest.requires
  const range = isRecord(requires) ? requires.astrail : undefined
  if (
    !isRecord(requires) ||
    Object.keys(requires).some((key) => key !== "astrail") ||
    typeof range !== "string" ||
    !range.trim() ||
    !validRange(range)
  ) {
    return result(undefined, [
      diagnostic("ASTR1201", "error", "requires must contain an astrail semver range", {
        location,
        remediation: 'Declare requires.astrail as a quoted range, for example ">=0.3.0 <0.4.0".',
      }),
    ])
  }
  const supported = valid(version) !== null && satisfies(version, range)
  const requirement: AstrailRequirement = { source, pointer, range, supported }
  return result(
    requirement,
    supported
      ? []
      : [
          diagnostic(
            "ASTR1202",
            "error",
            `Astrail ${version} does not satisfy requires.astrail ${range} in ${source}`,
            {
              location,
              details: { version, requiredRange: range, source },
              remediation: `Use an Astrail version satisfying "${range}". For an existing workspace, update its package.json dependency and lockfile and install it; for initialization, rerun init using pnpm dlx with a compatible astrail version.`,
            },
          ),
        ],
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
