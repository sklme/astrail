import { readFile, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, relative, resolve } from "node:path"
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js"
import {
  type AstrailWorkspaceV1Alpha1,
  configSchema,
  effectiveWorkspaceSchema,
  localSchema,
  lockSchema,
  workspaceSchema,
} from "astrail-schema"
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml"
import { composeLayers } from "./composition.js"
import {
  assertConfigContained,
  configCacheRoot,
  configIntegrity,
  configKey,
  configManifestPath,
  normalizeConfigReference,
  safeConfigPath,
} from "./config-source.js"
import { pathExists } from "./fs.js"
import { inspectRepository } from "./git.js"
import {
  ASTRAIL_ENGINE_VERSION,
  type AstrailRuntimeCompatibility,
  inspectAstrailRequirement,
  isRuntimeRequirementDiagnostic,
} from "./runtime-requirements.js"
import {
  type ConfigLayer,
  type ConfigSetup,
  type ConfigSource,
  type Diagnostic,
  diagnostic,
  type LoadedConfig,
  type LoadedWorkspace,
  result,
  type SourceLocation,
} from "./types.js"

const require = createRequire(import.meta.url)
interface AjvInstance {
  compile(schema: Record<string, unknown>): ValidateFunction
}
const Ajv2020 = require("ajv/dist/2020.js").default as new (
  options: Record<string, unknown>,
) => AjvInstance
const addFormats = require("ajv-formats").default as (instance: AjvInstance) => AjvInstance
const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true })
addFormats(ajv)
const validateWorkspaceSchema = ajv.compile(workspaceSchema)
const validateLocalSchema = ajv.compile(localSchema)
const validateLockSchema = ajv.compile(lockSchema)
const validateConfigSchema = ajv.compile(configSchema)
const validateEffectiveSchema = ajv.compile({
  ...effectiveWorkspaceSchema,
  $id: "astrail:effective-workspace",
})

const DEFAULTS: Record<string, unknown> = {
  policies: {
    strict: false,
    allowNetwork: false,
    recommendations: "show",
    projectionStrategy: "link",
  },
  targets: {
    codex: { type: "codex", primary: true },
  },
}

export interface ParsedDocument {
  value: Record<string, unknown>
  locations: Record<string, SourceLocation>
  diagnostics: Diagnostic[]
}

export async function discoverWorkspaceRoot(
  start = process.cwd(),
  explicitConfig?: string,
): Promise<{ root: string; configPath: string }> {
  if (explicitConfig) {
    const configPath = resolve(start, explicitConfig)
    if (!(await pathExists(configPath))) throw new Error(`Astrail config not found: ${configPath}`)
    return { root: dirname(configPath), configPath }
  }

  let current = resolve(start)
  while (true) {
    const configPath = join(current, "astrail.yaml")
    if (await pathExists(configPath)) return { root: current, configPath }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`No astrail.yaml found from ${resolve(start)}`)
}

export async function parseYamlFile(
  path: string,
  validator?: ValidateFunction,
): Promise<ParsedDocument> {
  return parseYamlText(await readFile(path, "utf8"), path, validator)
}

export function parseYamlText(
  text: string,
  path: string,
  validator?: ValidateFunction,
): ParsedDocument {
  const lineCounter = new LineCounter()
  const document = parseDocument(text, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  })
  const diagnostics: Diagnostic[] = []
  for (const error of document.errors) {
    const position =
      error.pos[0] === undefined ? { line: 1, col: 1 } : lineCounter.linePos(error.pos[0])
    diagnostics.push(
      diagnostic("ASTR1001", "error", sanitizeMessage(error.message), {
        location: { file: path, line: position.line, column: position.col, pointer: "" },
      }),
    )
  }
  for (const warning of document.warnings) {
    const position =
      warning.pos[0] === undefined ? { line: 1, col: 1 } : lineCounter.linePos(warning.pos[0])
    diagnostics.push(
      diagnostic("ASTR1002", "warning", sanitizeMessage(warning.message), {
        location: { file: path, line: position.line, column: position.col, pointer: "" },
      }),
    )
  }
  if (/^\s*<<\s*:/m.test(text)) {
    diagnostics.push(
      diagnostic("ASTR1003", "error", "YAML merge keys are not Astrail composition semantics", {
        remediation:
          "Use extends, a Workspace declaration, or a local overlay with stable entity IDs.",
      }),
    )
  }

  const locations: Record<string, SourceLocation> = {
    "": { file: path, line: 1, column: 1, pointer: "" },
  }
  if (document.contents) collectLocations(document.contents, [], path, lineCounter, locations)

  let value: Record<string, unknown> = {}
  if (document.errors.length === 0) {
    const converted = document.toJS({ maxAliasCount: 50 })
    if (isRecord(converted)) value = converted
    else diagnostics.push(diagnostic("ASTR1004", "error", "Astrail YAML root must be a mapping"))
  }

  if (validator && !validator(value))
    diagnostics.push(...ajvDiagnostics(validator.errors, path, locations))
  diagnostics.push(...literalSecretDiagnostics(value, path, locations))
  return { value, locations, diagnostics }
}

export async function loadWorkspace(
  options: { cwd?: string; config?: string; ignoreLock?: boolean; astrailVersion?: string } = {},
): Promise<LoadedWorkspace> {
  const { root, configPath } = await discoverWorkspaceRoot(options.cwd, options.config)
  const shared = await parseYamlFile(configPath, validateWorkspaceSchema)
  const diagnostics = [...shared.diagnostics]
  const runtime: AstrailRuntimeCompatibility = {
    version: options.astrailVersion ?? ASTRAIL_ENGINE_VERSION,
    supported: true,
    requirements: [],
  }
  const requirement = inspectAstrailRequirement(
    shared.value,
    configPath,
    runtime.version,
    shared.locations,
  )
  diagnostics.push(...requirement.diagnostics)
  if (requirement.data) runtime.requirements.push(requirement.data)
  const layers: ConfigLayer[] = [
    {
      id: "core-defaults",
      kind: "default",
      order: 0,
      source: "astrail:defaults",
      value: DEFAULTS,
      locations: {},
    },
  ]

  const lockPath = join(root, "astrail.lock.yaml")
  const lock =
    !options.ignoreLock && (await pathExists(lockPath))
      ? await parseYamlFile(lockPath, validateLockSchema)
      : undefined
  if (lock) diagnostics.push(...lock.diagnostics)
  const configs: LoadedConfig[] = []
  const configLayers = await loadConfigLayers(
    root,
    configPath,
    shared.value,
    diagnostics,
    runtime,
    configs,
    lock?.diagnostics.some((item) => item.severity === "error") ? undefined : lock?.value,
  )
  layers.push(...configLayers)
  layers.push({
    id: "workspace",
    kind: "shared",
    order: 20_000,
    source: configPath,
    value: shared.value,
    locations: shared.locations,
  })

  const localPath = join(root, "astrail.local.yaml")
  if (await pathExists(localPath)) {
    const local = await parseYamlFile(localPath, validateLocalSchema)
    diagnostics.push(...local.diagnostics)
    layers.push({
      id: "local",
      kind: "local",
      order: 30_000,
      source: localPath,
      // Journal preferences are machine-local runtime settings. They must not
      // affect effective configuration or invalidate reviewed mutation plans.
      value: stripHeaders(
        Object.fromEntries(Object.entries(local.value).filter(([key]) => key !== "journal")),
      ),
      locations: local.locations,
    })
  }

  if (lock) {
    layers.push({
      id: "lock",
      kind: "lock",
      order: 40_000,
      source: lockPath,
      value: lockToConstraints(lock.value),
      locations: lock.locations,
    })
  }

  const composed = composeLayers(layers)
  const effective = composed.value as unknown as AstrailWorkspaceV1Alpha1
  for (const [id, repository] of Object.entries(effective.repositories ?? {})) {
    if (repository?.source?.type !== "local" || !repository.source.path) continue
    const origin = composed.provenance[`/repositories/${escapePointer(id)}/source/path`]?.at(-1)
    if (origin?.kind === "config") {
      repository.source.path = resolve(dirname(origin.source), repository.source.path)
    }
  }
  const effectiveLocations = { ...shared.locations }
  for (const [pointer, entries] of Object.entries(composed.provenance)) {
    const location = entries.at(-1)?.location
    if (location) effectiveLocations[pointer] = location
  }
  if (!validateEffectiveSchema(effective)) {
    diagnostics.push(
      ...ajvDiagnostics(
        validateEffectiveSchema.errors,
        configPath,
        effectiveLocations,
        "ASTR1010",
      ).map((item) =>
        configs.some((config) => !config.available && config.source.type !== "local")
          ? {
              ...item,
              severity: "warning" as const,
              message: `Awaiting shared configs: ${item.message}`,
            }
          : item,
      ),
    )
  }

  runtime.supported = !diagnostics.some(isRuntimeRequirementDiagnostic)
  return {
    root,
    configPath,
    layers,
    effective,
    provenance: composed.provenance,
    diagnostics,
    runtime,
    configs,
  }
}

export async function inspectWorkspaceRuntime(
  options: { cwd?: string; config?: string; astrailVersion?: string } = {},
) {
  const loaded = await loadWorkspace(options)
  const diagnostics = loaded.diagnostics.filter(
    (item) =>
      isRuntimeRequirementDiagnostic(item) ||
      ["ASTR1001", "ASTR1003", "ASTR1004"].includes(item.code),
  )
  return result(
    { root: loaded.root, runtime: { ...loaded.runtime, supported: diagnostics.length === 0 } },
    diagnostics,
  )
}

async function loadConfigLayers(
  root: string,
  configPath: string,
  shared: Record<string, unknown>,
  diagnostics: Diagnostic[],
  runtime: AstrailRuntimeCompatibility,
  configs: LoadedConfig[],
  lock?: Record<string, unknown>,
): Promise<ConfigLayer[]> {
  const layers: ConfigLayer[] = []
  const canonicalRoot = await realpath(root)
  const visiting = new Set<string>()
  const observedByKey = new Map<string, LoadedConfig>()
  const gitRefs = new Map<string, string>()
  const lockedEntries = lock && isRecord(lock.configs) ? lock.configs : {}

  const visit = async (
    reference: unknown,
    declaringPath: string,
    parent?: ConfigSource,
  ): Promise<void> => {
    if (visiting.size >= 64 || observedByKey.size >= 512) {
      diagnostics.push(
        diagnostic("ASTR1107", "error", "Config graph exceeds the depth or size limit"),
      )
      return
    }
    let normalized: Awaited<ReturnType<typeof normalizeConfigReference>>
    try {
      normalized = await normalizeConfigReference(reference, declaringPath, parent)
    } catch (error) {
      diagnostics.push(
        diagnostic(
          "ASTR1101",
          "error",
          error instanceof Error ? error.message : "Invalid config source",
          {
            details: { declaringPath },
          },
        ),
      )
      return
    }
    const { source, integrity: declaredIntegrity } = normalized
    const key = configKey(source, canonicalRoot)
    if (visiting.has(key)) {
      diagnostics.push(
        diagnostic(
          "ASTR1105",
          "error",
          `Config reference cycle at ${configManifestPath(root, source)}`,
        ),
      )
      return
    }
    if (source.type === "git") {
      const coordinate = JSON.stringify([source.url, source.path])
      const prior = gitRefs.get(coordinate)
      if (prior !== undefined && prior !== (source.ref ?? "")) {
        diagnostics.push(
          diagnostic(
            "ASTR1106",
            "error",
            `Conflicting Git refs for ${source.url} / ${source.path}`,
          ),
        )
        return
      }
      gitRefs.set(coordinate, source.ref ?? "")
    }
    const previous = observedByKey.get(key)
    if (previous) {
      if (
        declaredIntegrity &&
        previous.expectedIntegrity &&
        previous.expectedIntegrity !== declaredIntegrity
      )
        diagnostics.push(
          diagnostic(
            "ASTR1104",
            "error",
            "Repeated config references specify conflicting integrity",
          ),
        )
      if (declaredIntegrity && previous.integrity && previous.integrity !== declaredIntegrity)
        diagnostics.push(
          diagnostic(
            "ASTR1104",
            "error",
            "Repeated config reference integrity does not match cached content",
          ),
        )
      if (declaredIntegrity) previous.expectedIntegrity = declaredIntegrity
      return
    }
    const candidateLock = lockedEntries[key]
    const matchingLock =
      isRecord(candidateLock) &&
      isRecord(candidateLock.source) &&
      configKey(candidateLock.source as unknown as ConfigSource, canonicalRoot) === key
        ? candidateLock
        : undefined
    const expectedIntegrity =
      declaredIntegrity ??
      (typeof matchingLock?.integrity === "string" ? matchingLock.integrity : undefined)
    const expectedCommit =
      typeof matchingLock?.resolvedCommit === "string" ? matchingLock.resolvedCommit : undefined
    const manifestPath = configManifestPath(root, source)
    const observed: LoadedConfig = {
      key,
      source,
      manifestPath,
      available: false,
      ...(expectedIntegrity ? { expectedIntegrity } : {}),
      ...(expectedCommit ? { expectedCommit } : {}),
    }
    observedByKey.set(key, observed)
    if (
      declaredIntegrity &&
      typeof matchingLock?.integrity === "string" &&
      declaredIntegrity !== matchingLock.integrity
    ) {
      configs.push(observed)
      diagnostics.push(
        diagnostic("ASTR1104", "error", `Config ${manifestPath} integrity conflicts with its lock`),
      )
      return
    }
    if (!(await pathExists(manifestPath))) {
      configs.push(observed)
      const acquiredGit = source.type === "git" && (await pathExists(configCacheRoot(root, source)))
      diagnostics.push(
        diagnostic(
          "ASTR1102",
          source.type === "local" || acquiredGit ? "error" : "warning",
          `Config ${source.type === "local" ? source.path : source.url} is unavailable`,
          {
            remediation:
              source.type === "local" || acquiredGit
                ? `Check the config file path: ${manifestPath}`
                : "Run astrail bootstrap with network authorization to acquire it.",
          },
        ),
      )
      return
    }
    try {
      if (source.type === "git")
        await assertConfigContained(configCacheRoot(root, source), manifestPath)
      const text = await readFile(manifestPath, "utf8")
      observed.integrity = configIntegrity(text)
      const parsed = parseConfigText(text, manifestPath, source.type === "http")
      const requirement = inspectAstrailRequirement(
        parsed.value,
        manifestPath,
        runtime.version,
        parsed.locations,
      )
      parsed.diagnostics.push(...requirement.diagnostics)
      if (requirement.data) runtime.requirements.push(requirement.data)
      if (expectedIntegrity && expectedIntegrity !== observed.integrity)
        parsed.diagnostics.push(
          diagnostic("ASTR1104", "error", `Config ${manifestPath} integrity drift detected`),
        )
      if (source.type === "git") {
        const repository = await inspectRepository(configCacheRoot(root, source))
        if (repository.revision) observed.resolvedCommit = repository.revision
        if (!repository.isGitRepository || !repository.revision || repository.dirty)
          parsed.diagnostics.push(
            diagnostic(
              "ASTR1104",
              "error",
              `Git config checkout ${configCacheRoot(root, source)} is invalid or modified`,
            ),
          )
        if (expectedCommit && expectedCommit !== repository.revision)
          parsed.diagnostics.push(
            diagnostic(
              "ASTR1104",
              "error",
              `Config ${manifestPath} differs from its locked Git commit`,
            ),
          )
        await validateGitConfigResources(parsed.value, manifestPath, configCacheRoot(root, source))
      }
      diagnostics.push(...parsed.diagnostics)
      const invalid = parsed.diagnostics.some((item) => item.severity === "error")
      if (
        invalid &&
        parsed.diagnostics.some(
          (item) => item.severity === "error" && !isRuntimeRequirementDiagnostic(item),
        )
      ) {
        configs.push(observed)
        return
      }
      observed.available = !invalid
      if (isRecord(parsed.value.setup)) observed.setup = parsed.value.setup as ConfigSetup
      visiting.add(key)
      for (const dependency of Array.isArray(parsed.value.extends) ? parsed.value.extends : [])
        await visit(dependency, manifestPath, source)
      visiting.delete(key)
      configs.push(observed)
      if (invalid) return
      layers.push({
        id: `config:${key}`,
        kind: "config",
        order: 1_000 + layers.length,
        source: manifestPath,
        value: configContributions(parsed.value),
        locations: parsed.locations,
      })
    } catch (error) {
      visiting.delete(key)
      configs.push(observed)
      diagnostics.push(
        diagnostic(
          "ASTR1101",
          "error",
          `Cannot load config ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }
  }
  for (const reference of Array.isArray(shared.extends) ? shared.extends : [])
    await visit(reference, configPath)
  return layers
}

export function parseConfigText(text: string, source: string, http = false): ParsedDocument {
  const parsed = parseYamlText(text, source, validateConfigSchema)
  if (http) parsed.diagnostics.push(...httpConfigDiagnostics(parsed.value, source))
  return parsed
}

function httpConfigDiagnostics(value: Record<string, unknown>, source: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const reject = (pointer: string) =>
    diagnostics.push(
      diagnostic(
        "ASTR1113",
        "error",
        `HTTP config cannot reference adjacent/local resources at ${pointer}`,
        {
          location: { file: source, line: 1, column: 1, pointer },
          remediation:
            "Use explicit Git Skills and HTTP/Git config references; publish bundled files as a Git config.",
        },
      ),
    )
  if (isRecord(value.capabilities))
    for (const [id, capability] of Object.entries(value.capabilities)) {
      if (
        isRecord(capability) &&
        isRecord(capability.source) &&
        !["git", "builtin"].includes(String(capability.source.type))
      )
        reject(`/capabilities/${id}/source`)
    }
  if (isRecord(value.contexts))
    for (const [id, context] of Object.entries(value.contexts)) {
      if (isRecord(context) && !["builtin", "external"].includes(String(context.kind)))
        reject(`/contexts/${id}`)
    }
  if (isRecord(value.repositories))
    for (const [id, repository] of Object.entries(value.repositories)) {
      if (isRecord(repository) && isRecord(repository.source) && repository.source.type === "local")
        reject(`/repositories/${id}/source`)
    }
  for (const [index, ref] of (Array.isArray(value.extends) ? value.extends : []).entries()) {
    if (
      !(typeof ref === "string" && /^https?:\/\//.test(ref)) &&
      !(isRecord(ref) && (typeof ref.http === "string" || typeof ref.git === "string"))
    )
      reject(`/extends/${index}`)
  }
  return diagnostics
}

export async function validateGitConfigResources(
  value: Record<string, unknown>,
  file: string,
  checkout: string,
): Promise<void> {
  const paths: string[] = []
  for (const group of ["capabilities", "contexts", "repositories"]) {
    const entries = value[group]
    if (!isRecord(entries)) continue
    for (const entry of Object.values(entries)) {
      if (!isRecord(entry)) continue
      const resource = isRecord(entry.source) ? entry.source : entry
      const resourcePath = resource.path ?? resource.pattern
      if (
        typeof resourcePath !== "string" ||
        resource.type === "git" ||
        resource.type === "repository" ||
        resource.type === "subpath"
      )
        continue
      paths.push(resourcePath)
    }
  }
  for (const raw of paths) {
    const path = resolve(dirname(file), raw)
    const subpath = relative(checkout, path)
    if (subpath) safeConfigPath(subpath)
    // A glob's fixed prefix can itself contain a symlink. Check its nearest
    // existing ancestor without requiring the resource to have been installed.
    let ancestor = path.split(/[?*[{]/)[0] ?? path
    while (!(await pathExists(ancestor)) && ancestor !== dirname(ancestor))
      ancestor = dirname(ancestor)
    await assertConfigContained(checkout, ancestor)
  }
}

function configContributions(value: Record<string, unknown>): Record<string, unknown> {
  const copy = stripHeaders(value)
  delete copy.metadata
  delete copy.extends
  delete copy.setup
  delete copy.requires
  return copy
}

function lockToConstraints(lock: Record<string, unknown>): Record<string, unknown> {
  const capabilities: Record<string, unknown> = {}
  if (isRecord(lock.capabilities))
    for (const [id, entry] of Object.entries(lock.capabilities)) {
      if (!isRecord(entry)) continue
      capabilities[id] = {
        ...(typeof entry.version === "string" ? { version: entry.version } : {}),
        ...(typeof entry.integrity === "string" ? { integrity: entry.integrity } : {}),
      }
    }
  return { capabilities }
}

function stripHeaders(value: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(value)
  delete copy.$schema
  delete copy.apiVersion
  delete copy.kind
  return copy
}

function collectLocations(
  node: unknown,
  path: string[],
  file: string,
  lines: LineCounter,
  output: Record<string, SourceLocation>,
): void {
  const pointer = `/${path.map(escapePointer).join("/")}`.replace(/^\/$/, "")
  const range = nodeRange(node)
  if (range?.[0] !== undefined) {
    const position = lines.linePos(range[0])
    output[pointer] = { file, line: position.line, column: position.col, pointer }
  }
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key)) continue
      const key = String(pair.key.value)
      if (pair.value) collectLocations(pair.value, [...path, key], file, lines, output)
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => {
      if (item) collectLocations(item, [...path, String(index)], file, lines, output)
    })
  }
}

function ajvDiagnostics(
  errors: ErrorObject[] | null | undefined,
  file: string,
  locations: Record<string, SourceLocation>,
  code = "ASTR1005",
): Diagnostic[] {
  return (errors ?? []).map((error) => {
    const pointer = error.instancePath || ""
    const unsupportedVersion = pointer === "/apiVersion" && error.keyword === "const"
    const message = unsupportedVersion
      ? "Unsupported apiVersion; this release supports astrail.dev/v1alpha1"
      : `${pointer || "/"} ${error.message ?? "is invalid"}`
    return diagnostic(code, "error", message, {
      location: nearestLocation(locations, pointer) ?? { file, line: 1, column: 1, pointer },
      ...(unsupportedVersion
        ? {
            remediation:
              "Migrate the manifest explicitly before retrying; Astrail never migrates silently.",
          }
        : {}),
      details: { keyword: error.keyword, params: error.params },
    })
  })
}

function literalSecretDiagnostics(
  value: Record<string, unknown>,
  file: string,
  locations: Record<string, SourceLocation>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const visit = (input: unknown, pointer: string): void => {
    if (!isRecord(input)) {
      if (Array.isArray(input)) {
        input.forEach((item, index) => {
          visit(item, `${pointer}/${index}`)
        })
      }
      return
    }
    for (const [key, child] of Object.entries(input)) {
      const next = `${pointer}/${escapePointer(key)}`
      if (/^(?:secret|password|token|credential|apiKey)$/i.test(key) && !isSecretReference(child)) {
        diagnostics.push(
          diagnostic("ASTR1020", "error", `Literal secret-like value at ${next} is not allowed`, {
            location: nearestLocation(locations, next) ?? {
              file,
              line: 1,
              column: 1,
              pointer: next,
            },
            remediation: "Use a { provider, key } secret reference.",
          }),
        )
      }
      visit(child, next)
    }
  }
  visit(value, "")
  return diagnostics
}

function isSecretReference(value: unknown): boolean {
  return isRecord(value) && typeof value.provider === "string" && typeof value.key === "string"
}

function nearestLocation(locations: Record<string, SourceLocation>, pointer: string) {
  let current = pointer
  while (current) {
    if (locations[current]) return locations[current]
    current = current.slice(0, current.lastIndexOf("/"))
  }
  return locations[""]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nodeRange(value: unknown): [number, number, number?] | undefined {
  if (!isRecord(value) || !Array.isArray(value.range)) return undefined
  const [start, end, suffix] = value.range
  if (typeof start !== "number" || typeof end !== "number") return undefined
  return typeof suffix === "number" ? [start, end, suffix] : [start, end]
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1")
}

function sanitizeMessage(value: string): string {
  return value.replaceAll(/(password|token|secret|credential)\s*[:=]\s*\S+/gi, "$1=<redacted>")
}
