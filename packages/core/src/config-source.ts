import { createHash } from "node:crypto"
import { realpath } from "node:fs/promises"
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path"
import type { ConfigSource } from "./types.js"

export const DEFAULT_CONFIG_FILE = "astrail.config.yaml"

export function configKey(source: ConfigSource, workspaceRoot?: string): string {
  const coordinates =
    source.type === "git"
      ? ["git", source.url, source.ref ?? "", source.path]
      : source.type === "http"
        ? ["http", source.url]
        : [
            "local",
            workspaceRoot
              ? relative(workspaceRoot, resolve(workspaceRoot, source.path))
              : source.path,
          ]
  return createHash("sha256").update(JSON.stringify(coordinates)).digest("hex")
}

export function configCacheRoot(root: string, source: ConfigSource): string {
  if (source.type === "local") return dirname(source.path)
  const key =
    source.type === "git" ? configKey({ ...source, path: DEFAULT_CONFIG_FILE }) : configKey(source)
  return join(root, ".astrail", "cache", "configs", key)
}

export function configManifestPath(root: string, source: ConfigSource): string {
  if (source.type === "local") return source.path
  return join(
    configCacheRoot(root, source),
    source.type === "git" ? source.path : DEFAULT_CONFIG_FILE,
  )
}

export function safeConfigPath(path: string): string {
  if (!path || path.includes("\\") || /[\0\r\n]/.test(path) || isAbsolute(path))
    throw new Error("Git config path must be a relative file path")
  const normalized = posix.normalize(path)
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized === "." ||
    normalized.split("/").includes(".git")
  )
    throw new Error("Git config path must stay inside the checkout and outside .git")
  return normalized
}

export async function assertConfigContained(root: string, path: string): Promise<void> {
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(path)])
  const subpath = relative(realRoot, realPath)
  if (subpath === ".." || subpath.startsWith("../") || isAbsolute(subpath))
    throw new Error("Git config or resource escapes its checkout through a symlink")
}

export async function normalizeConfigReference(
  reference: unknown,
  declaringPath: string,
  parent?: ConfigSource,
): Promise<{ source: ConfigSource; integrity?: string }> {
  const item =
    typeof reference === "string"
      ? /^https?:\/\//.test(reference)
        ? { http: reference }
        : { local: reference }
      : reference
  if (!item || typeof item !== "object" || Array.isArray(item))
    throw new Error("Invalid extends reference")
  const value = item as Record<string, unknown>
  const integrity = typeof value.integrity === "string" ? value.integrity : undefined
  if (typeof value.git === "string") {
    if (!value.git.trim() || value.git.startsWith("-") || /[\0\r\n]/.test(value.git))
      throw new Error("Invalid Git URL")
    const ref = typeof value.ref === "string" ? value.ref : undefined
    if (ref !== undefined && (!ref.trim() || ref.startsWith("-") || /[\0\r\n]/.test(ref)))
      throw new Error("Invalid Git ref")
    let url = value.git
    if (url.startsWith(".")) {
      if (parent?.type === "http" || parent?.type === "git")
        throw new Error("Remote configs require explicit Git URLs")
      url = resolve(dirname(declaringPath), url)
    }
    return {
      source: {
        type: "git",
        url,
        ...(ref ? { ref } : {}),
        path: safeConfigPath(typeof value.path === "string" ? value.path : DEFAULT_CONFIG_FILE),
      },
      ...(integrity ? { integrity } : {}),
    }
  }
  if (typeof value.http === "string") {
    const url = validateHttpConfigUrl(value.http).href
    return { source: { type: "http", url }, ...(integrity ? { integrity } : {}) }
  }
  if (typeof value.local !== "string" || !value.local.trim() || /[\0\r\n]/.test(value.local))
    throw new Error("Invalid local config path")
  if (/^[a-z][a-z0-9+.-]*:/i.test(value.local))
    throw new Error("Unsupported config source; use a local file, HTTP URL or Git reference")
  if (parent?.type === "http") throw new Error("HTTP configs cannot extend local or adjacent files")
  if (parent?.type === "git") {
    if (isAbsolute(value.local)) throw new Error("Git configs cannot extend absolute local paths")
    return {
      source: {
        ...parent,
        path: safeConfigPath(posix.join(posix.dirname(parent.path), value.local)),
      },
    }
  }
  const path = resolve(dirname(declaringPath), value.local)
  return { source: { type: "local", path: await realpath(path).catch(() => path) } }
}

export const HTTP_CONFIG_MAX_BYTES = 1024 * 1024

export function configIntegrity(text: string): string {
  return `sha256-${createHash("sha256").update(text).digest("base64")}`
}

export function validateHttpConfigUrl(value: string): URL {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error("HTTP config URLs must use HTTP(S) without credentials or fragments")
  return url
}

// No network access occurs during resolution; authorized install/update acquisition calls this.
export async function downloadHttpConfig(address: string): Promise<string> {
  let url = validateHttpConfigUrl(address)
  const signal = AbortSignal.timeout(15_000)
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, { redirect: "manual", signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get("location")
      if (!location) throw new Error("HTTP config redirect has no location")
      const next = validateHttpConfigUrl(new URL(location, url).href)
      if (url.protocol === "https:" && next.protocol !== "https:")
        throw new Error("HTTP config redirect cannot downgrade HTTPS")
      url = next
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error(`HTTP config download failed (status ${response.status})`)
    }
    if (Number(response.headers.get("content-length")) > HTTP_CONFIG_MAX_BYTES) {
      await response.body.cancel()
      throw new Error("HTTP config exceeds the 1 MiB limit")
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > HTTP_CONFIG_MAX_BYTES) throw new Error("HTTP config exceeds the 1 MiB limit")
        chunks.push(value)
      }
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        Buffer.concat(chunks),
      )
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
  throw new Error("HTTP config exceeded the redirect limit")
}
