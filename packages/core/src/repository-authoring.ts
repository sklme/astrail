import { createHash } from "node:crypto"
import { basename, isAbsolute, join, normalize, sep } from "node:path"
import type { Repository } from "astrail-schema"
import { parseDocument, stringify } from "yaml"
import { configBindingSnapshot } from "./config-inputs.js"
import { acquireOperationLock, atomicWrite, readTextIfExists } from "./fs.js"
import { journalChange, journalTargets } from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import {
  applyRepositoryPreparation,
  planRepositoryPreparation,
  type RepositoryPreparationPlan,
} from "./repository-preparation.js"
import { resolveWorkspace } from "./resolver.js"
import {
  type Diagnostic,
  diagnostic,
  type ResolvedRepository,
  type Result,
  result,
} from "./types.js"

export type RepositoryManifestTarget = "auto" | "shared" | "local"

export type RepositoryAdditionSource =
  | {
      type: "git"
      url: string
      revision?: { branch?: string; tag?: string; commit?: string }
    }
  | { type: "local"; path: string }
  | { type: "subpath"; repository: string; path: string }

export interface RepositoryAdditionRequest {
  prepare?: boolean
  id?: string
  source: RepositoryAdditionSource
  access?: "read-only" | "read-write"
  required?: boolean
  description?: string
  role?: string
  trust?: { instructions?: "trusted" | "disabled" }
  writeTarget?: RepositoryManifestTarget
}

export interface NormalizedRepositoryAddition {
  prepare: boolean
  id: string
  repository: Repository
  requestedTarget: RepositoryManifestTarget
  selectedTarget: "shared" | "split"
}

export interface RepositoryFileChange {
  target: "shared" | "local"
  path: string
  kind: "create" | "update"
  beforeDigest: string
  afterDigest: string
  repositoryValue: Record<string, unknown>
}

export interface RepositoryAdditionPlan {
  operation: "repository-add"
  planId: string
  root: string
  configPath: string
  configDigest: string
  registration: "add" | "reuse"
  preparation: RepositoryPreparationPlan
  addition: NormalizedRepositoryAddition | null
  files: RepositoryFileChange[]
  actions: Array<{
    id: string
    type: "write" | "clone" | "check"
    target: string
    description: string
    requiresAuthorization: true
  }>
  diagnostics: Diagnostic[]
}

export interface RepositoryAdditionApplyData {
  applied: boolean
  preparation?: { status: "ready" | "failed" | "skipped" }
  plan: RepositoryAdditionPlan
  repository?: ResolvedRepository
}

export interface RepositoryAdditionApplyOptions {
  authorized?: boolean
  expectedPlanId?: string
}

export async function planRepositoryAddition(
  input: unknown,
  options: { cwd?: string; config?: string } = {},
): Promise<RepositoryAdditionPlan> {
  const loaded = await loadWorkspace(options)
  const workspace = await resolveWorkspace(options)
  const diagnostics = uniqueDiagnostics([...loaded.diagnostics, ...workspace.diagnostics])
  const addition = normalizeAddition(input, workspace.config.repositories ?? {}, diagnostics)
  const files: RepositoryFileChange[] = []
  const existing = addition ? workspace.config.repositories?.[addition.id] : undefined
  const registration = existing ? "reuse" : "add"
  const configDigest = hash(
    stableStringify([loaded.effective, configBindingSnapshot(loaded.configs)]),
  )
  let preparation: RepositoryPreparationPlan = { entries: [], diagnostics: [] }

  if (addition && existing && !sameRepository(existing, addition.repository)) {
    diagnostics.push(
      diagnostic(
        "ASTR7002",
        "error",
        `Repository ${addition.id} already exists with different configuration`,
        {
          remediation:
            "Choose a different repository ID. Updating repositories is a separate operation.",
        },
      ),
    )
  }

  if (addition) validateTopologyAddition(addition, workspace.config.repositories ?? {}, diagnostics)

  if (addition?.prepare && !hasErrors(diagnostics)) {
    preparation = await planRepositoryPreparation(
      {
        ...loaded.effective,
        repositories: {
          ...loaded.effective.repositories,
          [addition.id]: existing ?? addition.repository,
        },
      },
      loaded.root,
      addition.id,
    )
    diagnostics.push(...preparation.diagnostics)
  }

  if (addition && !existing && !hasErrors(diagnostics)) {
    const sharedRepository =
      addition.selectedTarget === "split"
        ? withoutLocalPath(addition.repository)
        : addition.repository
    const shared = await planFileChange(
      loaded.configPath,
      "shared",
      addition.id,
      sharedRepository as unknown as Record<string, unknown>,
      diagnostics,
    )
    if (shared) files.push(shared)

    if (addition.selectedTarget === "split") {
      const path =
        addition.repository.source.type === "local" ? addition.repository.source.path : undefined
      if (path) {
        const local = await planFileChange(
          join(loaded.root, "astrail.local.yaml"),
          "local",
          addition.id,
          { source: { path } },
          diagnostics,
        )
        if (local) files.push(local)
      }
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path))
  const planId = hash(
    stableStringify({
      root: loaded.root,
      configDigest,
      addition,
      registration,
      preparation,
      files: files.map(({ path, beforeDigest, afterDigest, repositoryValue }) => ({
        path,
        beforeDigest,
        afterDigest,
        repositoryValue,
      })),
    }),
  )
  journalTargets({ repositories: addition ? [addition.id] : [], planId })
  return {
    operation: "repository-add",
    planId,
    root: loaded.root,
    configPath: loaded.configPath,
    configDigest,
    registration,
    preparation,
    addition,
    files,
    actions: [
      ...files.map((file) => ({
        id: `write:${file.target}:${addition?.id ?? "repository"}`,
        type: "write" as const,
        target: file.path,
        description:
          `${file.kind === "create" ? "Create" : "Update"} ${file.target} manifest for repository ${addition?.id ?? ""}`.trim(),
        requiresAuthorization: true as const,
      })),
      ...preparation.entries.map(({ repository, action }) => ({
        id: `${action}:${repository.id}`,
        type: action,
        target: repository.path ?? "",
        description:
          action === "clone" && repository.source.type === "git"
            ? `Clone ${repository.source.url} for repository ${repository.id}${repository.source.revision ? ` at ${JSON.stringify(repository.source.revision)}` : ""}`
            : `Verify existing repository ${repository.id}`,
        requiresAuthorization: true as const,
      })),
    ],
    diagnostics,
  }
}

export async function applyRepositoryAddition(
  plan: RepositoryAdditionPlan,
  options: RepositoryAdditionApplyOptions = {},
): Promise<Result<RepositoryAdditionApplyData>> {
  journalTargets({ repositories: plan.addition ? [plan.addition.id] : [], planId: plan.planId })
  const diagnostics = [...plan.diagnostics]
  const data: RepositoryAdditionApplyData = { applied: false, plan }
  if (hasErrors(diagnostics) || !plan.addition) return result(data, diagnostics)

  if (!options.authorized) {
    diagnostics.push(
      diagnostic("ASTR7006", "error", "Adding a repository requires explicit authorization", {
        remediation: "Review the plan, then authorize that exact plan.",
      }),
    )
    return result(data, diagnostics)
  }
  if (options.expectedPlanId !== undefined && options.expectedPlanId !== plan.planId) {
    diagnostics.push(
      diagnostic("ASTR7007", "error", "Repository plan does not match the reviewed plan", {
        remediation: "Run a new dry-run, review it, and authorize its planId.",
        details: { expected: options.expectedPlanId, actual: plan.planId },
      }),
    )
    return result(data, diagnostics)
  }

  const lock = await acquireOperationLock(plan.root)
  const originals = new Map<string, string | undefined>()
  let writesStarted = false
  try {
    for (const file of plan.files) {
      const current = await readTextIfExists(file.path)
      originals.set(file.path, current)
      if (hashOptional(current) !== file.beforeDigest) {
        diagnostics.push(
          diagnostic("ASTR7008", "error", `Repository plan is stale for ${file.path}`, {
            remediation: "Run a new dry-run and review the updated plan.",
            details: { expected: file.beforeDigest, actual: hashOptional(current) },
          }),
        )
      }
    }
    if (hasErrors(diagnostics)) return result(data, diagnostics)

    const currentConfig = await loadWorkspace({ cwd: plan.root, config: plan.configPath })
    if (
      hash(
        stableStringify([currentConfig.effective, configBindingSnapshot(currentConfig.configs)]),
      ) !== plan.configDigest
    ) {
      diagnostics.push(
        diagnostic("ASTR7008", "error", "Repository plan configuration has changed", {
          remediation: "Preview the same request again and review the updated plan.",
        }),
      )
      return result(data, diagnostics)
    }
    if (plan.addition.prepare) {
      const currentPreparation = await planRepositoryPreparation(
        {
          ...currentConfig.effective,
          repositories: {
            ...currentConfig.effective.repositories,
            [plan.addition.id]:
              currentConfig.effective.repositories?.[plan.addition.id] ?? plan.addition.repository,
          },
        },
        plan.root,
        plan.addition.id,
      )
      if (stableStringify(currentPreparation) !== stableStringify(plan.preparation)) {
        diagnostics.push(
          diagnostic("ASTR7008", "error", "Repository preparation destinations have changed", {
            remediation: "Preview the same request again and review its destinations.",
          }),
        )
        return result(data, diagnostics)
      }
    }

    for (const file of plan.files) {
      const current = originals.get(file.path)
      const content = renderRepositoryEdit(
        current,
        file.target,
        plan.addition.id,
        file.repositoryValue,
      )
      if (hash(content) !== file.afterDigest) {
        diagnostics.push(
          diagnostic("ASTR7009", "error", `Repository plan rendering changed for ${file.path}`, {
            remediation: "Run a new dry-run with the current Astrail version.",
          }),
        )
        return result(data, diagnostics)
      }
      writesStarted = true
      await atomicWrite(file.path, content)
    }

    const verified = await resolveWorkspace({ cwd: plan.root, config: plan.configPath })
    const verificationErrors = verified.diagnostics.filter((item) => item.severity === "error")
    const repository = verified.topology.repositories.find((item) => item.id === plan.addition?.id)
    if (verificationErrors.length > 0 || !repository) {
      diagnostics.push(
        ...verificationErrors,
        diagnostic("ASTR7010", "error", "Repository addition failed composed verification", {
          remediation: "The original manifests were restored.",
        }),
      )
      diagnostics.push(...(await restoreFiles(originals)))
      return result(data, uniqueDiagnostics(diagnostics))
    }
    // From here on registration is complete. Preparation failure must not roll it back.
    if (plan.registration === "add")
      journalChange({
        kind: "repository",
        target: repository.id,
        action: "register",
        before: null,
        after: {
          sourceType: repository.source.type,
          access: repository.access,
          required: repository.required,
        },
      })
    data.applied = true
    data.repository = repository
    writesStarted = false
    if (!plan.addition.prepare) {
      return result({ ...data, preparation: { status: "skipped" } }, uniqueDiagnostics(diagnostics))
    }
    try {
      await applyRepositoryPreparation(plan.preparation)
      return result({ ...data, preparation: { status: "ready" } }, uniqueDiagnostics(diagnostics))
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR7015",
          "error",
          `Repository registered but preparation failed: ${error instanceof Error ? error.message : String(error)}`,
          {
            remediation:
              "Fix the reported preparation problem, then preview and apply the same repo add request to retry. Registration has been preserved.",
          },
        ),
      )
      return result({ ...data, preparation: { status: "failed" } }, uniqueDiagnostics(diagnostics))
    }
  } catch (error) {
    if (writesStarted) diagnostics.push(...(await restoreFiles(originals)))
    diagnostics.push(
      diagnostic(
        "ASTR7011",
        "error",
        `Failed to apply repository plan: ${error instanceof Error ? error.message : String(error)}`,
        { remediation: "The original manifests were restored when possible." },
      ),
    )
    return result(data, uniqueDiagnostics(diagnostics))
  } finally {
    await lock.release()
  }
}

function normalizeAddition(
  input: unknown,
  repositories: Record<string, Repository>,
  diagnostics: Diagnostic[],
): NormalizedRepositoryAddition | null {
  if (!isRecord(input)) {
    diagnostics.push(diagnostic("ASTR7001", "error", "Repository input must be a JSON object"))
    return null
  }
  validateKnownFields(
    input,
    [
      "id",
      "source",
      "access",
      "required",
      "description",
      "role",
      "trust",
      "writeTarget",
      "prepare",
    ],
    "repository input",
    diagnostics,
  )
  if (!isRecord(input.source) || typeof input.source.type !== "string") {
    diagnostics.push(
      diagnostic("ASTR7001", "error", "Repository input requires source.type", {
        remediation: "Use git, local, or subpath.",
      }),
    )
    return null
  }

  const source = normalizeSource(input.source, diagnostics)
  if (!source) return null
  if (input.prepare !== undefined && typeof input.prepare !== "boolean") {
    diagnostics.push(diagnostic("ASTR7001", "error", "Repository prepare must be a boolean"))
  }
  const explicitId = typeof input.id === "string" ? input.id.trim() : undefined
  const id = explicitId || deriveRepositoryId(source)
  if (!id || !/^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(id)) {
    diagnostics.push(
      diagnostic("ASTR7001", "error", `Invalid repository ID ${id || "<missing>"}`, {
        remediation:
          "Use a lowercase identifier starting with a letter and containing letters, digits, '-', '_', or '.'.",
      }),
    )
    return null
  }

  const access = normalizeAccess(input.access, source, repositories, diagnostics)
  const required = input.required === undefined ? true : input.required
  if (typeof required !== "boolean") {
    diagnostics.push(diagnostic("ASTR7001", "error", "Repository required must be a boolean"))
  }
  if (input.trust !== undefined && !isRecord(input.trust)) {
    diagnostics.push(diagnostic("ASTR7001", "error", "Repository trust must be an object"))
  }
  if (isRecord(input.trust)) {
    validateKnownFields(input.trust, ["instructions"], "repository trust", diagnostics)
  }
  const instructions = isRecord(input.trust) ? input.trust.instructions : undefined
  if (instructions !== undefined && instructions !== "trusted" && instructions !== "disabled") {
    diagnostics.push(
      diagnostic("ASTR7001", "error", "Repository instruction trust must be trusted or disabled"),
    )
  }
  const requestedTarget = normalizeTarget(input.writeTarget, diagnostics)
  if (requestedTarget === "local" && source.type !== "local") {
    diagnostics.push(
      diagnostic("ASTR7004", "error", "Only local repositories can use the local manifest target", {
        remediation: "Use shared or auto for Git and subpath repositories.",
      }),
    )
  }
  const selectedTarget =
    source.type === "local" &&
    (requestedTarget === "local" || (requestedTarget === "auto" && isAbsolute(source.path)))
      ? "split"
      : "shared"

  const description = optionalString(input.description, "description", diagnostics)
  const role = optionalString(input.role, "role", diagnostics)
  if (!description) {
    diagnostics.push(
      diagnostic("ASTR7013", "information", `Repository ${id} has no description`, {
        remediation:
          "Add a concise description of what this repository owns to the request, then review the new plan before applying it.",
        details: { repository: id, field: "description" },
      }),
    )
  }
  const repository: Repository = {
    ...(description ? { description } : {}),
    required: typeof required === "boolean" ? required : true,
    access,
    ...(role ? { role } : {}),
    source,
    ...(instructions === "trusted" ? { trust: { instructions } } : {}),
  }
  return { id, repository, requestedTarget, selectedTarget, prepare: input.prepare !== false }
}

function sameRepository(existing: Repository, proposed: Repository): boolean {
  const normalized = (repository: Repository) => ({
    ...repository,
    required: repository.required ?? true,
    access: repository.access ?? (repository.source.type === "local" ? "read-only" : "read-write"),
    trust: { instructions: repository.trust?.instructions ?? "disabled" },
    disabled: repository.disabled ?? false,
  })
  return stableStringify(normalized(existing)) === stableStringify(normalized(proposed))
}

function normalizeSource(
  source: Record<string, unknown>,
  diagnostics: Diagnostic[],
): RepositoryAdditionSource | null {
  if (source.type === "git") {
    validateKnownFields(source, ["type", "url", "revision"], "Git source", diagnostics)
    const url = typeof source.url === "string" ? source.url.trim() : ""
    if (!url) {
      diagnostics.push(diagnostic("ASTR7001", "error", "Git repository source requires url"))
      return null
    }
    const revision = normalizeRevision(source.revision, diagnostics)
    return { type: "git", url, ...(revision ? { revision } : {}) }
  }
  if (source.type === "local") {
    validateKnownFields(source, ["type", "path"], "local source", diagnostics)
    const path = typeof source.path === "string" ? source.path.trim() : ""
    if (!path) {
      diagnostics.push(diagnostic("ASTR7001", "error", "Local repository source requires path"))
      return null
    }
    return { type: "local", path }
  }
  if (source.type === "subpath") {
    validateKnownFields(source, ["type", "repository", "path"], "subpath source", diagnostics)
    const repository = typeof source.repository === "string" ? source.repository.trim() : ""
    const path = typeof source.path === "string" ? source.path.trim() : ""
    if (!repository || !path) {
      diagnostics.push(
        diagnostic("ASTR7001", "error", "Subpath repository source requires repository and path"),
      )
      return null
    }
    return { type: "subpath", repository, path }
  }
  diagnostics.push(
    diagnostic("ASTR7001", "error", `Unsupported repository source type ${source.type}`, {
      remediation: "Use git, local, or subpath.",
    }),
  )
  return null
}

function normalizeRevision(
  value: unknown,
  diagnostics: Diagnostic[],
): { branch?: string; tag?: string; commit?: string } | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("ASTR7001", "error", "Git revision must be an object"))
    return undefined
  }
  validateKnownFields(value, ["branch", "tag", "commit"], "Git revision", diagnostics)
  const entries = (["branch", "tag", "commit"] as const).flatMap((key) =>
    typeof value[key] === "string" && value[key].trim() ? [[key, value[key].trim()] as const] : [],
  )
  if (entries.length !== 1) {
    diagnostics.push(
      diagnostic("ASTR7001", "error", "Git revision requires exactly one branch, tag, or commit"),
    )
    return undefined
  }
  return Object.fromEntries(entries)
}

function normalizeAccess(
  value: unknown,
  source: RepositoryAdditionSource,
  repositories: Record<string, Repository>,
  diagnostics: Diagnostic[],
): "read-only" | "read-write" {
  if (value === "read-only" || value === "read-write") return value
  if (value !== undefined) {
    diagnostics.push(
      diagnostic("ASTR7001", "error", "Repository access must be read-only or read-write"),
    )
  }
  if (source.type === "local") return "read-only"
  if (source.type === "subpath") return repositories[source.repository]?.access ?? "read-only"
  return "read-write"
}

function normalizeTarget(value: unknown, diagnostics: Diagnostic[]): RepositoryManifestTarget {
  if (value === undefined) return "auto"
  if (value === "auto" || value === "shared" || value === "local") return value
  diagnostics.push(
    diagnostic("ASTR7001", "error", "Repository writeTarget must be auto, shared, or local"),
  )
  return "auto"
}

function validateTopologyAddition(
  addition: NormalizedRepositoryAddition,
  repositories: Record<string, Repository>,
  diagnostics: Diagnostic[],
): void {
  const source = addition.repository.source
  if (source.type !== "subpath") return
  const parent = repositories[source.repository]
  if (!parent) {
    diagnostics.push(
      diagnostic(
        "ASTR2014",
        "error",
        `Subpath repository ${addition.id} references unknown repository ${source.repository}`,
      ),
    )
  }
  if (!isSafeSubpath(source.path)) {
    diagnostics.push(
      diagnostic("ASTR2016", "error", `Subpath repository ${addition.id} has an unsafe path`, {
        details: { path: source.path },
      }),
    )
  }
  if (parent?.access === "read-only" && addition.repository.access === "read-write") {
    diagnostics.push(
      diagnostic(
        "ASTR2017",
        "error",
        `Subpath repository ${addition.id} cannot widen read-only parent ${source.repository}`,
      ),
    )
  }
}

async function planFileChange(
  path: string,
  target: RepositoryFileChange["target"],
  id: string,
  repositoryValue: Record<string, unknown>,
  diagnostics: Diagnostic[],
): Promise<RepositoryFileChange | undefined> {
  const current = await readTextIfExists(path)
  try {
    const next = renderRepositoryEdit(current, target, id, repositoryValue)
    return {
      target,
      path,
      kind: current === undefined ? "create" : "update",
      beforeDigest: hashOptional(current),
      afterDigest: hash(next),
      repositoryValue,
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        "ASTR7005",
        "error",
        `Cannot edit ${path}: ${error instanceof Error ? error.message : String(error)}`,
        { remediation: "Repair the YAML file before adding a repository." },
      ),
    )
    return undefined
  }
}

function renderRepositoryEdit(
  current: string | undefined,
  target: RepositoryFileChange["target"],
  id: string,
  repositoryValue: Record<string, unknown>,
): string {
  const initial =
    current ??
    stringify(
      {
        $schema: "https://sklme.github.io/astrail/schema/local/v1alpha1.json",
        apiVersion: "astrail.dev/v1alpha1",
        kind: target === "local" ? "WorkspaceLocal" : "Workspace",
        ...(target === "shared" ? { metadata: { name: "workspace" } } : {}),
      },
      { lineWidth: 0 },
    )
  const document = parseDocument(initial, { strict: true, uniqueKeys: true })
  if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? "Invalid YAML")
  document.setIn(["repositories", id], repositoryValue)
  return document.toString({ lineWidth: 0 })
}

function withoutLocalPath(repository: Repository): Repository {
  if (repository.source.type !== "local") return repository
  return { ...repository, source: { type: "local" } }
}

async function restoreFiles(originals: Map<string, string | undefined>): Promise<Diagnostic[]> {
  const { rm } = await import("node:fs/promises")
  const diagnostics: Diagnostic[] = []
  for (const [path, content] of originals) {
    try {
      if (content === undefined) await rm(path, { force: true })
      else await atomicWrite(path, content)
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR7012",
          "error",
          `Failed to restore ${path}: ${error instanceof Error ? error.message : String(error)}`,
          { remediation: "Restore this manifest from version control or backup before retrying." },
        ),
      )
    }
  }
  return diagnostics
}

function deriveRepositoryId(source: RepositoryAdditionSource): string {
  const candidate =
    source.type === "git"
      ? source.url
          .replace(/[?#].*$/, "")
          .replace(/\/$/, "")
          .replace(/\.git$/, "")
          .split(/[/:]/)
          .at(-1)
      : basename(source.path)
  return (candidate ?? "")
    .toLocaleLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

function isSafeSubpath(path: string): boolean {
  if (!path || isAbsolute(path) || path.includes("\\")) return false
  const normalized = normalize(path)
  return normalized !== "." && normalized !== ".." && !normalized.startsWith(`..${sep}`)
}

function optionalString(
  value: unknown,
  name: string,
  diagnostics: Diagnostic[],
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    diagnostics.push(diagnostic("ASTR7001", "error", `Repository ${name} must be a string`))
    return undefined
  }
  return value.trim() || undefined
}

function validateKnownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  diagnostics: Diagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    diagnostics.push(
      diagnostic("ASTR7001", "error", `Unknown ${label} field ${key}`, {
        remediation: "Remove the field or use a supported repository authoring property.",
      }),
    )
  }
}

function hashOptional(value: string | undefined): string {
  return hash(value === undefined ? "<astrail:missing>" : value)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error")
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((item) => {
    const key = stableStringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
