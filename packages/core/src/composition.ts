import type { ConfigLayer, ProvenanceEntry, ProvenanceIndex } from "./types.js"

export interface CompositionResult {
  value: Record<string, unknown>
  provenance: ProvenanceIndex
}

export function composeLayers(layers: readonly ConfigLayer[]): CompositionResult {
  const value: Record<string, unknown> = {}
  const provenance: ProvenanceIndex = {}
  for (const layer of [...layers].sort((left, right) => left.order - right.order)) {
    mergeObject(value, layer.value, "", layer, provenance)
  }
  return { value, provenance }
}

function mergeObject(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
  pointer: string,
  layer: ConfigLayer,
  provenance: ProvenanceIndex,
): void {
  for (const key of Object.keys(incoming).sort()) {
    const nextPointer = `${pointer}/${escapePointer(key)}`
    const next = incoming[key]
    const current = Object.hasOwn(target, key) ? target[key] : undefined
    if (isPlainObject(next) && isPlainObject(current)) {
      record(provenance, nextPointer, layer, "merged", next)
      mergeObject(current, next, nextPointer, layer, provenance)
      continue
    }
    const existed = Object.hasOwn(target, key)
    if (existed) markLastSelectedOverridden(provenance[nextPointer])
    Object.defineProperty(target, key, {
      value: cloneValue(next),
      enumerable: true,
      writable: true,
      configurable: true,
    })
    record(
      provenance,
      nextPointer,
      layer,
      isPlainObject(next) && next.disabled === true
        ? "disabled"
        : existed
          ? "selected"
          : "selected",
      next,
    )
    if (isPlainObject(next)) recordNested(next, nextPointer, layer, provenance)
  }
}

function recordNested(
  value: Record<string, unknown>,
  pointer: string,
  layer: ConfigLayer,
  provenance: ProvenanceIndex,
): void {
  for (const key of Object.keys(value).sort()) {
    const child = value[key]
    const childPointer = `${pointer}/${escapePointer(key)}`
    record(provenance, childPointer, layer, "selected", child)
    if (isPlainObject(child)) recordNested(child, childPointer, layer, provenance)
  }
}

function record(
  provenance: ProvenanceIndex,
  pointer: string,
  layer: ConfigLayer,
  action: ProvenanceEntry["action"],
  value: unknown,
): void {
  const entries = provenance[pointer] ?? []
  const location = nearestLocation(layer.locations, pointer)
  entries.push({
    layer: layer.id,
    kind: layer.kind,
    source: layer.source,
    pointer,
    action,
    value: cloneValue(value),
    ...(location ? { location } : {}),
  })
  provenance[pointer] = entries
}

function markLastSelectedOverridden(entries: ProvenanceEntry[] | undefined): void {
  if (!entries) return
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry && entry.action === "selected") {
      entry.action = "overridden"
      return
    }
  }
}

function nearestLocation(locations: ConfigLayer["locations"], pointer: string) {
  let candidate = pointer
  while (candidate) {
    if (locations[candidate]) return locations[candidate]
    candidate = candidate.slice(0, candidate.lastIndexOf("/"))
  }
  return locations[""]
}

export function normalizeConfigPath(path: string): string {
  if (path.startsWith("/")) return path
  const pieces = path.split(".").filter(Boolean).map(escapePointer)
  return `/${pieces.join("/")}`
}

export function explainProvenance(index: ProvenanceIndex, path: string): ProvenanceEntry[] {
  return index[normalizeConfigPath(path)] ?? []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value)
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1")
}
