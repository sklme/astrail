import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadWorkspace, parseYamlFile } from "./manifest.js"

describe("manifest loading", () => {
  it("loads a local override with source locations and preserves extensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-manifest-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: test
operations:
  prepare:
    provider: install
repositories:
  api:
    access: read-write
    source:
      type: local
      path: repos/api
extensions:
  example.vendor:
    enabled: true
`,
    )
    await writeFile(
      join(root, "astrail.local.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: WorkspaceLocal
repositories:
  api:
    source:
      path: ../api
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(loaded.effective.repositories?.api?.source).toEqual({
      type: "local",
      path: "../api",
    })
    expect(loaded.effective.extensions?.["example.vendor"]).toEqual({ enabled: true })
    expect(loaded.effective.operations?.prepare?.provider).toBe("install")
    expect(loaded.provenance["/repositories/api/source/path"]?.at(-1)?.location?.line).toBe(6)
  })

  it("rejects YAML merge keys and arbitrary context commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-invalid-"))
    const path = join(root, "astrail.yaml")
    await writeFile(
      path,
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata: &meta
  name: test
other:
  <<: *meta
contexts:
  generated:
    kind: builtin
    command: rm -rf /tmp/example
`,
    )
    const parsed = await parseYamlFile(path)
    expect(parsed.diagnostics.some((item) => item.code === "ASTR1003")).toBe(true)
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.some((item) => item.message.includes("additional properties"))).toBe(
      true,
    )
  })

  it("keeps repository trust limited to instruction activation", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-repository-trust-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: repository-trust
repositories:
  external:
    access: read-only
    source:
      type: local
      path: external
    trust:
      instructions: disabled
      content: content-only
      executable: disabled
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    const rejectedProperties = loaded.diagnostics
      .filter((item) => item.details?.keyword === "additionalProperties")
      .map((item) => item.details?.params)
    expect(rejectedProperties).toContainEqual({ additionalProperty: "content" })
    expect(rejectedProperties).toContainEqual({ additionalProperty: "executable" })
  })

  it("rejects legacy repository topology fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-legacy-repository-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: legacy-repository
repositories:
  api:
    access: writable
    presence: required
    path: repos/api
    remote: https://example.invalid/api.git
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    const rejectedProperties = loaded.diagnostics
      .filter((item) => item.details?.keyword === "additionalProperties")
      .map((item) => item.details?.params)
    expect(rejectedProperties).toContainEqual({ additionalProperty: "presence" })
    expect(rejectedProperties).toContainEqual({ additionalProperty: "path" })
    expect(rejectedProperties).toContainEqual({ additionalProperty: "remote" })
    expect(loaded.diagnostics.some((item) => item.details?.keyword === "enum")).toBe(true)
    expect(loaded.diagnostics.some((item) => item.details?.keyword === "required")).toBe(true)
  })

  it("redacts literal secret values from diagnostics", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-secret-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: secret
extensions:
  example.vendor:
    token: super-secret-value
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics.some((item) => item.code === "ASTR1020")).toBe(true)
    expect(JSON.stringify(loaded.diagnostics)).not.toContain("super-secret-value")
  })

  it("composes transitive local configs deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-configs-"))
    await mkdir(join(root, "parent"), { recursive: true })
    await mkdir(join(root, "dependency"), { recursive: true })
    await writeFile(
      join(root, "dependency", "astrail.config.yaml"),
      `apiVersion: astrail.dev/v1alpha1
metadata:
  name: community/dependency
  version: 1.2.0
contexts:
  dependency-guide:
    kind: file
    path: guide.md
`,
    )
    await writeFile(
      join(root, "parent", "astrail.config.yaml"),
      `apiVersion: astrail.dev/v1alpha1
metadata:
  name: community/parent
  version: 1.0.0
extends: [../dependency/astrail.config.yaml]
contexts:
  parent-guide:
    kind: file
    path: parent.md
`,
    )
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: configs
extends: [./parent/astrail.config.yaml]
`,
    )
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.layers.map((layer) => layer.kind)).toEqual([
      "default",
      "config",
      "config",
      "shared",
    ])
    expect(loaded.configs.map((config) => config.manifestPath)).toEqual([
      await realpath(join(root, "dependency/astrail.config.yaml")),
      await realpath(join(root, "parent/astrail.config.yaml")),
    ])
    expect(Object.keys(loaded.effective.contexts ?? {})).toEqual([
      "dependency-guide",
      "parent-guide",
    ])
    expect(loaded.diagnostics.filter((item) => item.severity === "error")).toEqual([])
  })
})
