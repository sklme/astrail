import { dirname, isAbsolute, resolve } from "node:path"
import type { AstrailWorkspaceV1Alpha1, Context } from "astrail-schema"
import { glob } from "glob"
import { readTextIfExists } from "./fs.js"
import {
  type Diagnostic,
  diagnostic,
  type ProvenanceIndex,
  type ResolvedContextSource,
} from "./types.js"

export function contextCatalog(
  config: AstrailWorkspaceV1Alpha1,
  root: string,
  provenance?: ProvenanceIndex,
): ResolvedContextSource[] {
  return Object.entries(config.contexts ?? {})
    .filter(([, source]) => source.disabled !== true)
    .map(([id, source]) =>
      toResolvedContext(id, source, declaringRoot(provenance, sourcePointer(id, source), root)),
    )
    .sort(compareContexts)
}

export async function loadContextContent(
  source: ResolvedContextSource,
): Promise<{ content?: string; files?: string[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  if (source.sensitivity === "secret") {
    return {
      diagnostics: [
        diagnostic(
          "ASTR3002",
          "warning",
          `Secret context ${source.id} cannot be emitted as plain content`,
        ),
      ],
    }
  }
  if (source.kind === "file") {
    const content = await readTextIfExists(source.location)
    if (content === undefined) {
      diagnostics.push(
        diagnostic("ASTR3003", "warning", `Context file is unavailable: ${source.location}`),
      )
      return { diagnostics }
    }
    return { content, diagnostics }
  }
  if (source.kind === "glob") {
    const files = await glob(source.location, { absolute: true, nodir: true })
    return { files: files.sort(), diagnostics }
  }
  return { diagnostics }
}

function toResolvedContext(id: string, source: Context, root: string): ResolvedContextSource {
  const rawLocation =
    source.path ??
    source.pattern ??
    source.resource ??
    source.pack ??
    `builtin://${source.provider ?? id}`
  const location =
    source.kind === "file" || source.kind === "glob"
      ? isAbsolute(rawLocation)
        ? rawLocation
        : resolve(root, rawLocation)
      : rawLocation
  return {
    id,
    kind: source.kind,
    location,
    ...((source.summary ?? source.description)
      ? { summary: source.summary ?? source.description }
      : {}),
    ...(source.scope ? { scope: source.scope } : {}),
    priority: source.priority ?? 0,
    trust: source.trust ?? "content-only",
    sensitivity: source.sensitivity ?? "workspace",
    ...(source.freshness ? { freshness: source.freshness } : {}),
    ...(source.budget !== undefined ? { budget: source.budget } : {}),
  }
}

function compareContexts(left: ResolvedContextSource, right: ResolvedContextSource): number {
  return right.priority - left.priority || left.id.localeCompare(right.id)
}

function declaringRoot(
  provenance: ProvenanceIndex | undefined,
  pointer: string,
  fallback: string,
): string {
  const location = provenance?.[pointer]?.at(-1)?.location
  return location ? dirname(location.file) : fallback
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1")
}

function sourcePointer(id: string, source: Context): string {
  const field = source.kind === "glob" ? "pattern" : "path"
  return `/contexts/${escapePointer(id)}/${field}`
}
