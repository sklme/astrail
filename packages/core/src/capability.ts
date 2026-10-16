import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import type { AstrailWorkspaceV1Alpha1, Capability } from "astrail-schema"
import { satisfies, valid } from "semver"
import { pathExists } from "./fs.js"
import {
  type Diagnostic,
  diagnostic,
  type ProvenanceIndex,
  type ResolvedCapability,
} from "./types.js"

export interface CapabilityRecommendation {
  requester: string
  identity: string
  version: string
  source: string
  installed: boolean
  suppressed: boolean
}

export interface CapabilityResolution {
  capabilities: ResolvedCapability[]
  recommendations: CapabilityRecommendation[]
  diagnostics: Diagnostic[]
}

export interface CapabilitySourceResolver {
  type: string
  resolve(
    capability: Capability,
    workspaceRoot: string,
  ): Promise<{ path?: string; available: boolean }>
}

export async function resolveCapabilities(
  config: AstrailWorkspaceV1Alpha1,
  root: string,
  provenance?: ProvenanceIndex,
  repositoryPaths: ReadonlyMap<string, string> = new Map(),
): Promise<CapabilityResolution> {
  const diagnostics: Diagnostic[] = []
  const recommendations: CapabilityRecommendation[] = []
  const declarations = Object.entries(config.capabilities ?? {}).filter(
    ([, value]) =>
      value.disabled !== true &&
      typeof value.identity === "string" &&
      typeof value.kind === "string",
  )
  const byIdentity = new Map(declarations.map(([id, value]) => [value.identity, { id, value }]))
  const aliases = new Map<string, string[]>()
  const capabilities: ResolvedCapability[] = []

  for (const [id, capability] of declarations.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const exposeAs = capability.exposeAs ?? defaultAlias(capability.identity)
    const collisions = aliases.get(exposeAs) ?? []
    collisions.push(id)
    aliases.set(exposeAs, collisions)
    const path = resolveCapabilityPath(capability, root, provenance, repositoryPaths, id)
    const available = path ? await pathExists(path) : capability.source?.type === "builtin"
    const executableTrust = capability.trust?.executable ?? "disabled"
    const sourceRepositoryId =
      capability.source?.type === "repository" ? capability.source.repository : undefined
    const sourceRepository = sourceRepositoryId
      ? config.repositories?.[sourceRepositoryId]
      : undefined
    const repositoryInstructionsTrusted = sourceRepository?.trust?.instructions === "trusted"
    const capabilityInstructionsTrusted = capability.trust?.instructions === "trusted"
    const repositorySkillBlocked =
      capability.kind === "skill" &&
      capability.source?.type === "repository" &&
      !repositoryInstructionsTrusted &&
      !capabilityInstructionsTrusted
    const gitSkillBlocked =
      capability.kind === "skill" &&
      capability.source?.type === "git" &&
      !capabilityInstructionsTrusted
    const active =
      (capability.kind !== "plugin" || executableTrust === "trusted") &&
      !repositorySkillBlocked &&
      !gitSkillBlocked
    capabilities.push({
      id,
      identity: capability.identity,
      version: capability.version ?? "*",
      kind: capability.kind,
      exposeAs,
      source: structuredClone(capability.source ?? { type: "workspace" }),
      ...(path ? { path } : {}),
      ...(capability.integrity ? { integrity: capability.integrity } : {}),
      active,
    })
    if (!available && capability.source?.type !== "registry" && capability.source?.type !== "git") {
      diagnostics.push(
        diagnostic(
          "ASTR4001",
          "warning",
          `Capability ${capability.identity} source is unavailable`,
          {
            details: { id, path },
          },
        ),
      )
    }
    if (available && path && capability.integrity) {
      const observedIntegrity = await capabilityIntegrity(path)
      if (observedIntegrity && observedIntegrity !== capability.integrity) {
        diagnostics.push(
          diagnostic(
            "ASTR4004",
            "error",
            `Capability ${capability.identity} integrity drift detected`,
            {
              details: { expected: capability.integrity, observed: observedIntegrity },
              remediation: "Review the source change and regenerate the lock before projection.",
            },
          ),
        )
      }
    }
    if (capability.kind === "plugin" && !active) {
      diagnostics.push(
        diagnostic(
          "ASTR4002",
          "warning",
          `Plugin ${capability.identity} is inactive until executable trust is granted`,
        ),
      )
    }
    if (repositorySkillBlocked) {
      diagnostics.push(
        diagnostic(
          "ASTR4005",
          "warning",
          `Skill ${capability.identity} is inactive because repository ${sourceRepository ? sourceRepositoryId : "source"} instructions are not trusted`,
          {
            remediation:
              "Review the repository, then explicitly trust its instructions or this capability before projection.",
          },
        ),
      )
    }
    if (gitSkillBlocked) {
      diagnostics.push(
        diagnostic(
          "ASTR4006",
          "warning",
          `Git Skill ${capability.identity} is inactive because its instructions are not trusted`,
          {
            remediation:
              "Review the remote Skill, then explicitly set capability trust.instructions to trusted before projection.",
          },
        ),
      )
    }
  }

  for (const [alias, ids] of aliases) {
    if (ids.length > 1) {
      diagnostics.push(
        diagnostic("ASTR4003", "error", `Capability alias ${alias} is ambiguous`, {
          details: { capabilities: ids },
          remediation: "Set a unique exposeAs value or disable one capability.",
        }),
      )
    }
  }

  for (const [id, capability] of declarations) {
    for (const dependency of capability.dependencies ?? []) {
      const provided = byIdentity.get(dependency.identity)
      const installed = Boolean(provided)
      const compatible = provided
        ? versionSatisfies(provided.value.version ?? "*", dependency.version ?? "*")
        : false
      if (dependency.mode === "recommended") {
        recommendations.push({
          requester: id,
          identity: dependency.identity,
          version: dependency.version ?? "*",
          source: capability.identity,
          installed: installed && compatible,
          suppressed:
            config.policies?.recommendations === "suppress" || capability.suppressed === true,
        })
        continue
      }
      if (dependency.mode === "conflicts" && installed && compatible) {
        diagnostics.push(
          diagnostic(
            "ASTR4010",
            "error",
            `${capability.identity} conflicts with ${dependency.identity}`,
          ),
        )
      } else if (
        (dependency.mode === "required" || dependency.mode === "peer") &&
        (!installed || !compatible)
      ) {
        diagnostics.push(
          diagnostic(
            dependency.mode === "required" ? "ASTR4011" : "ASTR4012",
            "error",
            `${capability.identity} requires ${dependency.mode} ${dependency.identity}@${dependency.version ?? "*"}`,
          ),
        )
      }
    }
  }

  recommendations.sort((left, right) =>
    `${left.identity}:${left.requester}`.localeCompare(`${right.identity}:${right.requester}`),
  )
  return { capabilities, recommendations, diagnostics }
}

export async function capabilityIntegrity(path: string): Promise<string | undefined> {
  if (!(await pathExists(path))) return undefined
  const digest = createHash("sha256")
  await appendIntegrity(digest, path, path)
  return `sha256-${digest.digest("base64")}`
}

async function appendIntegrity(
  digest: ReturnType<typeof createHash>,
  root: string,
  path: string,
): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => undefined)
  if (!entries) {
    digest.update(relative(root, path))
    digest.update(await readFile(path))
    return
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === ".git") continue
    const child = join(path, entry.name)
    digest.update(relative(root, child))
    if (entry.isDirectory()) await appendIntegrity(digest, root, child)
    else if (entry.isFile()) digest.update(await readFile(child))
  }
}

function resolveCapabilityPath(
  capability: Capability,
  root: string,
  provenance: ProvenanceIndex | undefined,
  repositoryPaths: ReadonlyMap<string, string>,
  id: string,
): string | undefined {
  if (capability.source?.type === "git") return undefined
  const raw = capability.source?.path
  if (!raw) return undefined
  if (isAbsolute(raw)) return raw
  if (capability.source?.type === "repository" && capability.source.repository) {
    const repositoryPath = repositoryPaths.get(capability.source.repository)
    if (repositoryPath) return resolve(root, repositoryPath, raw)
  }
  const pointer = `/capabilities/${escapePointer(id)}/source/path`
  const location = provenance?.[pointer]?.at(-1)?.location
  return resolve(location ? dirname(location.file) : root, raw)
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1")
}

function versionSatisfies(version: string, range: string): boolean {
  if (version === "*" || range === "*") return true
  return valid(version) ? satisfies(version, range) : version === range
}

function defaultAlias(identity: string): string {
  const withoutVersion = identity.replace(/@[^/]+$/, "")
  return withoutVersion.split("/").at(-1) ?? withoutVersion
}
