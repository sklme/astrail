import { resolve } from "node:path"
import { parseDocument, stringify } from "yaml"
import { readTextIfExists } from "./fs.js"
import { diagnostic, type Result, result } from "./types.js"

export interface MarketImportPreview {
  source: string
  manifest: Record<string, unknown>
  yaml: string
  assumptions: string[]
}

export async function previewMarketImport(source: string): Promise<Result<MarketImportPreview>> {
  const path = resolve(source)
  const text = await readTextIfExists(path)
  if (text === undefined) {
    return result({ source: path, manifest: {}, yaml: "", assumptions: [] }, [
      diagnostic("ASTR7001", "error", `Market workspace configuration not found: ${path}`),
    ])
  }
  const parsed = parseDocument(text).toJS() as Record<string, unknown>
  const repositories = normalizeRepositories(parsed.repositories ?? parsed.repos)
  const environments = normalizeNamedMap(parsed.environments ?? parsed.envs)
  const manifest: Record<string, unknown> = {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: inferName(path) },
    repositories,
    environments,
    targets: { codex: { type: "codex", primary: true } },
  }
  const assumptions = [
    "Repository access defaults to read-write unless the source explicitly marks it read-only.",
    "Repositories with a remote become managed Git sources under repos/<id>; other repositories become linked local sources.",
    "Environment names are preserved and are not inferred from branches.",
    "The preview does not modify the source workspace.",
  ]
  return result({
    source: path,
    manifest,
    yaml: stringify(manifest, { lineWidth: 0 }),
    assumptions,
  })
}

function normalizeRepositories(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).map(([id, repository]) => {
      const source = isRecord(repository) ? repository : {}
      const remote = typeof source.remote === "string" ? source.remote : undefined
      const path = typeof source.path === "string" ? source.path : undefined
      return [
        id,
        {
          required: source.optional !== true,
          access: source.readonly === true || source.readOnly === true ? "read-only" : "read-write",
          source: remote
            ? {
                type: "git",
                url: remote,
                ...(typeof source.branch === "string"
                  ? { revision: { branch: source.branch } }
                  : {}),
              }
            : { type: "local", ...(path ? { path } : {}) },
          trust: { instructions: "disabled" },
        },
      ]
    }),
  )
}

function normalizeNamedMap(value: unknown): Record<string, unknown> {
  return isRecord(value) ? structuredClone(value) : {}
}

function inferName(path: string): string {
  return (
    path
      .split(/[\\/]/)
      .at(-2)
      ?.toLocaleLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-") ?? "imported-workspace"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
