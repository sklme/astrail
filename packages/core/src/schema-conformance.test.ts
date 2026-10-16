import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { loadWorkspace } from "./manifest.js"

describe("workspace schema conformance", () => {
  it.each([
    {},
    { branches: {} },
    { branches: [] },
    { branches: { repo: 1 } },
    { branches: { repo: "" } },
    { branches: { repo: "   " } },
    { branch: " " },
  ])("rejects malformed checkout declarations: %j", async (checkout) => {
    const root = await mkdtemp(join(tmpdir(), "astrail-schema-checkout-"))
    await writeFile(
      join(root, "astrail.yaml"),
      JSON.stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "checkout" },
        environments: { default: { repositories: ["repo"], checkout } },
      }),
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.some((item) => item.severity === "error")).toBe(true)
  })

  const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/schema")
  it("accepts v1alpha1 and preserves namespaced extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-schema-supported-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: supported
extensions:
  example.vendor:
    arbitrary: true
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(loaded.effective.extensions?.["example.vendor"]).toEqual({ arbitrary: true })
  })

  it("rejects unsupported manifest versions with migration guidance", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-schema-unsupported-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v9
kind: Workspace
metadata:
  name: unsupported
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.some((item) => item.message.includes("astrail.dev/v1alpha1"))).toBe(
      true,
    )
  })

  it("preserves namespaced target extensions and rejects unsupported targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-schema-target-"))
    const manifestPath = join(root, "astrail.yaml")
    await writeFile(
      manifestPath,
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: target-extension
targets:
  codex:
    type: codex
    extensions:
      example.codex:
        discoveryMode: project
`,
    )
    const supported = await loadWorkspace({ cwd: root })
    expect(supported.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(supported.effective.targets?.codex?.extensions?.["example.codex"]).toEqual({
      discoveryMode: "project",
    })

    await writeFile(
      manifestPath,
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: unsupported-target
targets:
  future:
    type: future-agent
`,
    )
    const unsupported = await loadWorkspace({ cwd: root })
    expect(unsupported.diagnostics.some((item) => item.message.includes("must be equal"))).toBe(
      true,
    )
  })

  it("rejects removed context routing declarations", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-schema-context-routing-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: obsolete-context-routing
contexts:
  guide:
    kind: file
    path: docs/guide.md
    routing:
      taskKeywords: [guide]
    dependsOn: [base]
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.some((item) => item.message.includes("additional properties"))).toBe(
      true,
    )
  })

  it("accepts direct Git capabilities and rejects escaping content paths", async () => {
    const supported = await loadWorkspace({
      cwd: fixtures,
      config: "git-capability.yaml",
    })
    expect(supported.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(supported.effective.repositories).toBeUndefined()
    expect(supported.effective.capabilities?.loghelper?.source).toMatchObject({
      type: "git",
      path: "skills/loghelper",
    })

    const unsafe = await loadWorkspace({
      cwd: fixtures,
      config: "unsafe-git-capability.yaml",
    })
    expect(unsafe.diagnostics.some((item) => item.severity === "error")).toBe(true)
  })
})
