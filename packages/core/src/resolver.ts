import { isAbsolute, normalize, relative, resolve, sep } from "node:path"
import type { AstrailWorkspaceV1Alpha1, Repository } from "astrail-schema"
import { resolveCapabilities } from "./capability.js"
import { resolveConfigSetups } from "./config-setup.js"
import { contextCatalog } from "./context.js"
import { validateEnvironmentBranches } from "./environment-branches.js"
import { inspectRepository, inspectRepositorySubpath } from "./git.js"
import { journalStep } from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedRepository,
  type ResolvedWorkspace,
} from "./types.js"

export async function resolveWorkspace(
  options: {
    cwd?: string
    config?: string
    observe?: boolean
    ignoreLock?: boolean
    astrailVersion?: string
  } = {},
): Promise<ResolvedWorkspace> {
  return journalStep("workspace.resolve", () => resolveWorkspaceObserved(options))
}

async function resolveWorkspaceObserved(
  options: {
    cwd?: string
    config?: string
    observe?: boolean
    ignoreLock?: boolean
    astrailVersion?: string
  } = {},
): Promise<ResolvedWorkspace> {
  const loaded = await loadWorkspace(options)
  const diagnostics: Diagnostic[] = [...loaded.diagnostics]
  diagnostics.push(...validateReferences(loaded.effective))
  const repositories = await resolveRepositories(
    loaded.effective,
    loaded.root,
    options.observe === true,
    diagnostics,
  )

  const environments = sortedEntries(loaded.effective.environments)
    .filter(([, environment]) => environment.disabled !== true)
    .map(([id, environment]) => ({
      id,
      repositories: [...(environment.repositories ?? [])],
      ...(environment.checkout ? { checkout: environment.checkout } : {}),
      ...(environment.provider ? { provider: environment.provider } : {}),
      resources: redactSecrets(environment.resources ?? {}),
    }))

  const capabilityResolution = await resolveCapabilities(
    loaded.effective,
    loaded.root,
    loaded.provenance,
    new Map(
      repositories.flatMap((repository) =>
        repository.path ? ([[repository.id, repository.path]] as const) : [],
      ),
    ),
  )
  diagnostics.push(...capabilityResolution.diagnostics)
  const setupResolution = resolveConfigSetups(
    [
      ...loaded.configs,
      {
        key: "workspace",
        source: { type: "local", path: loaded.configPath },
        manifestPath: loaded.configPath,
        available: true,
        ...(loaded.effective.setup ? { setup: loaded.effective.setup } : {}),
      },
    ],
    capabilityResolution.capabilities,
  )
  diagnostics.push(...setupResolution.diagnostics)
  const operations = sortedEntries(loaded.effective.operations)
    .filter(([, operation]) => operation.disabled !== true)
    .map(([id, operation]) => ({
      id,
      provider: operation.provider,
      sideEffect: operation.sideEffect ?? defaultSideEffect(operation.provider),
    }))

  return {
    root: loaded.root,
    config: loaded.effective,
    topology: { repositories, environments },
    contexts: contextCatalog(loaded.effective, loaded.root, loaded.provenance),
    capabilities: capabilityResolution.capabilities,
    operations,
    provenance: loaded.provenance,
    diagnostics,
    runtime: loaded.runtime,
    configs: loaded.configs,
    configSetups: setupResolution.entries,
  }
}

interface InternalRepository {
  resolved: ResolvedRepository
  physicalRoot?: string
  relativeToPhysical?: string
}

export async function resolveRepositories(
  config: AstrailWorkspaceV1Alpha1,
  root: string,
  observe: boolean,
  diagnostics: Diagnostic[],
): Promise<ResolvedRepository[]> {
  const definitions = new Map(
    sortedEntries(config.repositories).filter(([, repository]) => repository.disabled !== true),
  )
  const cache = new Map<string, InternalRepository>()
  const visiting: string[] = []

  const visit = async (id: string): Promise<InternalRepository | undefined> => {
    const cached = cache.get(id)
    if (cached) return cached
    const repository = definitions.get(id)
    if (!repository || !isRepositorySource(repository.source)) return undefined

    const cycleIndex = visiting.indexOf(id)
    if (cycleIndex >= 0) {
      const cycle = [...visiting.slice(cycleIndex), id]
      diagnostics.push(
        diagnostic("ASTR2015", "error", `Repository dependency cycle: ${cycle.join(" -> ")}`, {
          details: { cycle },
        }),
      )
      return undefined
    }

    visiting.push(id)
    const required = repository.required ?? true
    const access = repository.access === "read-only" ? "read-only" : "read-write"
    let path: string | undefined
    let physicalRoot: string | undefined
    let relativeToPhysical: string | undefined

    if (repository.source.type === "git") {
      path = resolve(root, "repos", id)
      physicalRoot = path
      relativeToPhysical = ""
    } else if (repository.source.type === "local") {
      const declaredPath = repository.source.path
      if (declaredPath) {
        path = isAbsolute(declaredPath) ? declaredPath : resolve(root, declaredPath)
        physicalRoot = path
        relativeToPhysical = ""
      } else {
        diagnostics.push(
          diagnostic("ASTR2018", "error", `Local repository ${id} has no path`, {
            remediation: `Set repositories.${id}.source.path in astrail.yaml or astrail.local.yaml.`,
          }),
        )
      }
    } else {
      const parentId = repository.source.repository
      const parentDefinition = definitions.get(parentId)
      if (!parentDefinition) {
        diagnostics.push(
          diagnostic(
            "ASTR2014",
            "error",
            `Subpath repository ${id} references unknown repository ${parentId}`,
          ),
        )
      } else if (!isSafeSubpath(repository.source.path)) {
        diagnostics.push(
          diagnostic("ASTR2016", "error", `Subpath repository ${id} has an unsafe path`, {
            details: { path: repository.source.path },
          }),
        )
      } else {
        const parent = await visit(parentId)
        if (parent?.resolved.path) {
          path = containedPath(parent.resolved.path, repository.source.path)
          if (!path) {
            diagnostics.push(
              diagnostic(
                "ASTR2016",
                "error",
                `Subpath repository ${id} escapes repository ${parentId}`,
                { details: { path: repository.source.path } },
              ),
            )
          } else {
            physicalRoot = parent.physicalRoot ?? parent.resolved.path
            relativeToPhysical = relative(physicalRoot, path)
          }
        }
        if (parentDefinition.access === "read-only" && access === "read-write") {
          diagnostics.push(
            diagnostic(
              "ASTR2017",
              "error",
              `Subpath repository ${id} cannot widen read-only parent ${parentId}`,
            ),
          )
        }
      }
    }
    visiting.pop()

    const observation =
      observe && path
        ? repository.source.type === "subpath" && physicalRoot && relativeToPhysical
          ? await inspectRepositorySubpath(physicalRoot, relativeToPhysical)
          : await inspectRepository(path)
        : undefined
    if (observation && required && !observation.present) {
      diagnostics.push(
        diagnostic("ASTR2001", "error", `Required repository ${id} is missing`, {
          remediation:
            repository.source.type === "git"
              ? "Run astrail bootstrap to clone the repository."
              : "Configure or restore the declared local path.",
          details: { path },
        }),
      )
    }
    if (repository.source.type === "git" && observation?.present && !observation.isGitRepository) {
      diagnostics.push(
        diagnostic("ASTR2004", "error", `Managed Git repository ${id} is not a Git checkout`, {
          remediation:
            "Move the existing entry aside or declare it as a local source; Astrail will not clone over it.",
          details: { path },
        }),
      )
    }
    if (observation?.dirty && access === "read-only") {
      diagnostics.push(
        diagnostic("ASTR2002", "warning", `Read-only repository ${id} has local modifications`, {
          remediation: "Review or revert the changes outside Astrail.",
        }),
      )
    }
    if (repository.source.type === "git" && observation?.isGitRepository && !observation.remote) {
      diagnostics.push(
        diagnostic("ASTR2005", "warning", `Repository ${id} has no observable origin remote`, {
          remediation: "Configure origin or review the managed checkout identity manually.",
          details: { declared: repository.source.url, path },
        }),
      )
    } else if (
      repository.source.type === "git" &&
      observation?.isGitRepository &&
      observation.remote &&
      normalizeRemote(repository.source.url) !== normalizeRemote(observation.remote)
    ) {
      diagnostics.push(
        diagnostic(
          "ASTR2003",
          "warning",
          `Repository ${id} remote does not match its declaration`,
          {
            details: { declared: repository.source.url, observed: observation.remote },
          },
        ),
      )
    }

    const resolved: ResolvedRepository = {
      id,
      source: resolvedSource(repository),
      ...(path ? { path } : {}),
      required,
      access,
      ...(repository.description ? { description: repository.description } : {}),
      ...(repository.role ? { role: repository.role } : {}),
      trust: { instructions: repository.trust?.instructions ?? "disabled" },
      ...(observation ? { observation } : {}),
    }
    const internal: InternalRepository = {
      resolved,
      ...(physicalRoot ? { physicalRoot } : {}),
      ...(relativeToPhysical !== undefined ? { relativeToPhysical } : {}),
    }
    cache.set(id, internal)
    return internal
  }

  for (const id of [...definitions.keys()].sort()) await visit(id)
  return [...cache.values()]
    .map((repository) => repository.resolved)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function isRepositorySource(value: unknown): value is Repository["source"] {
  if (typeof value !== "object" || value === null || !("type" in value)) return false
  return value.type === "git" || value.type === "local" || value.type === "subpath"
}

function resolvedSource(repository: Repository): ResolvedRepository["source"] {
  const source = repository.source
  if (source.type === "git") {
    return {
      type: "git",
      url: source.url,
      ...(source.revision ? { revision: source.revision } : {}),
    }
  }
  if (source.type === "local") {
    return {
      type: "local",
      ...(source.path ? { declaredPath: source.path } : {}),
    }
  }
  return { type: "subpath", repository: source.repository, relativePath: source.path }
}

function isSafeSubpath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes("\\")) return false
  const normalized = normalize(path)
  return normalized !== "." && normalized !== ".." && !normalized.startsWith(`..${sep}`)
}

function containedPath(parent: string, subpath: string): string | undefined {
  const candidate = resolve(parent, subpath)
  const fromParent = relative(parent, candidate)
  if (!fromParent || fromParent === ".." || fromParent.startsWith(`..${sep}`)) return undefined
  return candidate
}

function sortedEntries<T>(value: Record<string, T> | undefined): [string, T][] {
  return Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right))
}

function normalizeRemote(value: string): string {
  return value
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
}

function redactSecrets(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSecretReference(item) ? { provider: item.provider, key: item.key } : item,
    ]),
  )
}

function isSecretReference(value: unknown): value is { provider: string; key: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    "key" in value &&
    typeof value.provider === "string" &&
    typeof value.key === "string"
  )
}

function defaultSideEffect(provider: string): string {
  if (["validate", "status", "doctor", "render"].includes(provider)) return "workspace-read"
  return "workspace-write"
}

function validateReferences(config: AstrailWorkspaceV1Alpha1): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const repositories = new Set(
    Object.entries(config.repositories ?? {})
      .filter(([, repository]) => repository.disabled !== true)
      .map(([id]) => id),
  )
  for (const [id, environment] of Object.entries(config.environments ?? {})) {
    if (environment.disabled === true) continue
    const hasRepositories = environment.repositories !== undefined
    const hasCheckout = environment.checkout !== undefined
    if (hasRepositories !== hasCheckout) {
      diagnostics.push(
        diagnostic(
          "ASTR2020",
          "error",
          `Environment ${id} must declare repositories and checkout together`,
          {
            remediation: `Set both environments.${id}.repositories and environments.${id}.checkout with branch or branches, or remove both for a resource-only environment.`,
          },
        ),
      )
    }
    if (environment.checkout) {
      diagnostics.push(
        ...validateEnvironmentBranches(id, environment.repositories ?? [], environment.checkout),
      )
    }
    for (const repository of environment.repositories ?? []) {
      if (!repositories.has(repository)) {
        diagnostics.push(
          diagnostic(
            "ASTR2021",
            "error",
            `Environment ${id} references unknown repository ${repository}`,
          ),
        )
      }
    }
  }
  for (const [id, capability] of Object.entries(config.capabilities ?? {})) {
    const repository =
      capability.source?.type === "repository" ? capability.source.repository : undefined
    if (capability.source?.type === "repository" && repository && !repositories.has(repository)) {
      diagnostics.push(
        diagnostic(
          "ASTR2012",
          "error",
          `Capability ${id} references unknown repository ${repository}`,
        ),
      )
    }
  }
  const primaryTargets = Object.values(config.targets ?? {}).filter(
    (target) => target.disabled !== true && target.primary === true,
  )
  if (primaryTargets.length > 1) {
    diagnostics.push(diagnostic("ASTR2013", "error", "Only one target can be primary"))
  }
  return diagnostics
}
