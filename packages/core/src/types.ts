import type { AstrailWorkspaceV1Alpha1, CapabilitySource, ConfigSetup } from "astrail-schema"
import type { AstrailRuntimeCompatibility } from "./runtime-requirements.js"

export type DiagnosticSeverity = "error" | "warning" | "information"

export interface SourceLocation {
  file: string
  line: number
  column: number
  pointer: string
}

export interface Diagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  location?: SourceLocation
  remediation?: string
  details?: Record<string, unknown>
}

export interface Result<T> {
  success: boolean
  data: T
  diagnostics: Diagnostic[]
}

export interface StructuredOutput<T> {
  schemaVersion: "1"
  command: string
  success: boolean
  data: T
  diagnostics: Diagnostic[]
  meta: {
    workspaceRoot?: string
    durationMs: number
  }
}

export type LayerKind = "default" | "config" | "shared" | "local" | "lock"

export interface ConfigLayer {
  id: string
  kind: LayerKind
  order: number
  source: string
  value: Record<string, unknown>
  locations: Record<string, SourceLocation>
}

export interface ProvenanceEntry {
  layer: string
  kind: LayerKind
  source: string
  pointer: string
  action: "selected" | "overridden" | "merged" | "disabled"
  value: unknown
  location?: SourceLocation
}

export type ProvenanceIndex = Record<string, ProvenanceEntry[]>

export interface LoadedWorkspace {
  root: string
  configPath: string
  layers: ConfigLayer[]
  effective: AstrailWorkspaceV1Alpha1
  provenance: ProvenanceIndex
  diagnostics: Diagnostic[]
  runtime: AstrailRuntimeCompatibility
  configs: LoadedConfig[]
}

export type { ConfigSetup } from "astrail-schema"

export type ConfigSource =
  | { type: "local"; path: string }
  | { type: "http"; url: string }
  | { type: "git"; url: string; ref?: string; path: string }

export interface LoadedConfig {
  key: string
  source: ConfigSource
  manifestPath: string
  available: boolean
  integrity?: string
  expectedIntegrity?: string
  resolvedCommit?: string
  expectedCommit?: string
  setup?: ConfigSetup
}

export interface ConfigSetupEntry {
  config: string
  mode: "skill"
  status: "pending" | "blocked"
  skill: string
  alias?: string
}

export interface RepositoryObservation {
  present: boolean
  isGitRepository: boolean
  gitDirKind?: "directory" | "file"
  branch?: string
  revision?: string
  dirty?: boolean
  remote?: string
}

export type ResolvedRepositorySource =
  | {
      type: "git"
      url: string
      revision?: { branch?: string; tag?: string; commit?: string }
    }
  | { type: "local"; declaredPath?: string }
  | { type: "subpath"; repository: string; relativePath: string }

export interface ResolvedRepository {
  id: string
  source: ResolvedRepositorySource
  path?: string
  required: boolean
  access: "read-only" | "read-write"
  description?: string
  role?: string
  trust: {
    instructions: "trusted" | "disabled"
  }
  observation?: RepositoryObservation
}

export interface ResolvedEnvironment {
  id: string
  repositories: string[]
  checkout?: { branch?: string; branches?: Record<string, string> }
  provider?: string
  resources: Record<string, unknown>
}

export interface ResolvedContextSource {
  id: string
  kind: string
  location: string
  summary?: string
  scope?: string
  priority: number
  trust: "trusted" | "content-only" | "untrusted"
  sensitivity: "public" | "workspace" | "restricted" | "secret"
  freshness?: string
  budget?: number
}

export interface ResolvedCapability {
  id: string
  identity: string
  version: string
  kind: "skill" | "tool" | "context-pack" | "plugin"
  exposeAs: string
  source: CapabilitySource
  path?: string
  integrity?: string
  active: boolean
}

export interface ResolvedOperation {
  id: string
  provider: string
  sideEffect: string
}

export interface ResolvedWorkspace {
  root: string
  config: AstrailWorkspaceV1Alpha1
  topology: {
    repositories: ResolvedRepository[]
    environments: ResolvedEnvironment[]
  }
  contexts: ResolvedContextSource[]
  capabilities: ResolvedCapability[]
  operations: ResolvedOperation[]
  provenance: ProvenanceIndex
  diagnostics: Diagnostic[]
  runtime: AstrailRuntimeCompatibility
  configs: LoadedConfig[]
  configSetups: ConfigSetupEntry[]
}

export function result<T>(data: T, diagnostics: Diagnostic[] = []): Result<T> {
  return {
    success: diagnostics.every((item) => item.severity !== "error"),
    data,
    diagnostics,
  }
}

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  options: {
    location?: SourceLocation
    remediation?: string
    details?: Record<string, unknown>
  } = {},
): Diagnostic {
  return { code, severity, message, ...options }
}
