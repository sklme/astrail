import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AstrailWorkspaceV1Alpha1 } from "astrail-schema"
import { describe, expect, it } from "vitest"
import { contextCatalog, loadContextContent } from "./context.js"

const config: AstrailWorkspaceV1Alpha1 = {
  apiVersion: "astrail.dev/v1alpha1",
  kind: "Workspace",
  metadata: { name: "catalog" },
  contexts: {
    contract: {
      kind: "file",
      path: "docs/contract.md",
      summary: "Canonical contract",
      scope: "contracts",
      priority: 100,
      freshness: "P7D",
      budget: 1200,
      trust: "trusted",
    },
    reference: {
      kind: "glob",
      pattern: "docs/*.md",
      priority: 10,
      trust: "content-only",
    },
    secrets: {
      kind: "external",
      resource: "vault://runtime",
      sensitivity: "secret",
      trust: "untrusted",
    },
  },
}

describe("context catalog", () => {
  it("returns stable metadata without making task decisions", () => {
    const first = contextCatalog(config, "/workspace")
    const second = contextCatalog(config, "/workspace")
    expect(second).toEqual(first)
    expect(first.map((item) => item.id)).toEqual(["contract", "reference", "secrets"])
    expect(first[0]).toMatchObject({
      summary: "Canonical contract",
      scope: "contracts",
      freshness: "P7D",
      budget: 1200,
      trust: "trusted",
    })
    expect(first[2]).toMatchObject({ trust: "untrusted", sensitivity: "secret" })
    expect(first[0]).not.toHaveProperty("selected")
  })

  it("loads one file explicitly and reports an unavailable file", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-context-file-"))
    await mkdir(join(root, "docs"), { recursive: true })
    const source = contextCatalog(config, root).find((item) => item.id === "contract")
    if (!source) throw new Error("Expected contract context")
    await writeFile(source.location, "contract content")
    const loaded = await loadContextContent(source)
    expect(loaded).toEqual({ content: "contract content", diagnostics: [] })

    const unavailable = await loadContextContent({
      ...source,
      location: join(root, "docs", "missing.md"),
    })
    expect(unavailable.diagnostics.some((item) => item.code === "ASTR3003")).toBe(true)
  })

  it("returns sorted glob matches without reading their contents", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-context-glob-"))
    const docs = join(root, "docs")
    await mkdir(docs, { recursive: true })
    await writeFile(join(docs, "b.md"), "b")
    await writeFile(join(docs, "a.md"), "a")
    const source = contextCatalog(config, root).find((item) => item.id === "reference")
    if (!source) throw new Error("Expected reference context")
    const loaded = await loadContextContent(source)
    expect(loaded.files).toEqual([join(docs, "a.md"), join(docs, "b.md")])
    expect(loaded.content).toBeUndefined()
  })

  it("does not emit secret context as plaintext", async () => {
    const source = contextCatalog(config, "/workspace").find((item) => item.id === "secrets")
    if (!source) throw new Error("Expected secret context")
    const loaded = await loadContextContent(source)
    expect(loaded.content).toBeUndefined()
    expect(loaded.diagnostics.some((item) => item.code === "ASTR3002")).toBe(true)
  })
})
