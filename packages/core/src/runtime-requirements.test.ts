import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { pathExists } from "./fs.js"
import {
  applyBootstrap,
  applyFilePlan,
  doctorWorkspace,
  planBootstrap,
  planLock,
  planUpdate,
} from "./lifecycle.js"
import { inspectWorkspaceRuntime, loadWorkspace } from "./manifest.js"
import { resolveWorkspace } from "./resolver.js"
import { ASTRAIL_ENGINE_VERSION, inspectAstrailRequirement } from "./runtime-requirements.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(requires?: unknown) {
  const root = await mkdtemp(join(tmpdir(), "astrail-requires-"))
  roots.push(root)
  await writeFile(
    join(root, "astrail.yaml"),
    JSON.stringify({
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "requires" },
      ...(requires === undefined ? {} : { requires }),
    }),
  )
  return root
}

describe("Astrail requirements", () => {
  it.each([
    [">=0.3.0 <0.4.0", "0.3.9", true],
    [">=0.3.0 <0.4.0", "0.2.9", false],
    [">=0.3.0 <0.4.0", "0.4.0", false],
    ["~0.3.1 || ^1.2.0", "1.3.0", true],
    ["0.3.x", "0.3.5", true],
    ["*", "0.3.0-beta.1", false],
    [">=0.3.0-beta.1 <0.4.0", "0.3.0-beta.2", true],
  ])("evaluates %s against %s with standard semver behavior", (range, version, supported) => {
    const inspected = inspectAstrailRequirement(
      { requires: { astrail: range } },
      "astrail.yaml",
      version,
    )
    expect(inspected.success).toBe(supported)
    expect(inspected.data).toMatchObject({ range, supported })
    if (!supported)
      expect(inspected.diagnostics[0]).toMatchObject({
        code: "ASTR1202",
        details: { version, requiredRange: range },
      })
  })

  it.each([
    null,
    "0.3.0",
    [],
    {},
    { astrail: 3 },
    { astrail: "" },
    { astrail: " " },
    { astrail: "latest" },
    { astrail: ">=0.3.0", typo: true },
  ])("rejects malformed requires: %j", async (requires) => {
    const root = await fixture(requires)
    const inspection = await inspectWorkspaceRuntime({ cwd: root })
    expect(inspection.success).toBe(false)
    expect(inspection.diagnostics[0]?.code).toBe("ASTR1201")
    expect(inspection.data.runtime.supported).toBe(false)
  })

  it("keeps old workspaces compatible without inserting a requirement", async () => {
    const root = await fixture()
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.effective.requires).toBeUndefined()
    expect(loaded.runtime).toEqual({
      version: ASTRAIL_ENGINE_VERSION,
      mode: "auto",
      supported: true,
      requirements: [],
    })
  })

  it("accepts the new schema and reports the source location of an incompatible version", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "astrail.yaml"),
      'apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: requirements }\nrequires:\n  astrail: ">=0.3.0 <0.4.0"\n',
    )
    const supported = await loadWorkspace({ cwd: root, astrailVersion: "0.3.2" })
    expect(supported.diagnostics).toEqual([])
    const unsupported = await loadWorkspace({ cwd: root, astrailVersion: "0.2.0" })
    expect(unsupported.diagnostics).toMatchObject([
      {
        code: "ASTR1202",
        location: { file: join(root, "astrail.yaml"), line: 5, pointer: "/requires/astrail" },
      },
    ])
  })

  it("checks each shared config requirement without allowing workspace overrides to weaken them", async () => {
    const root = await fixture({ astrail: "*" })
    const path = join(root, "astrail.yaml")
    const shared = JSON.parse(await readFile(path, "utf8"))
    shared.extends = ["./base/astrail.config.yaml"]
    await writeFile(path, JSON.stringify(shared))
    await mkdir(join(root, "base/nested"), { recursive: true })
    const basePath = join(root, "base/astrail.config.yaml")
    const nestedPath = join(root, "base/nested/astrail.config.yaml")
    await writeFile(
      basePath,
      JSON.stringify({
        apiVersion: "astrail.dev/v1alpha1",
        metadata: { name: "base", version: "1.0.0" },
        requires: { astrail: ">=99.0.0" },
        extends: ["./nested/astrail.config.yaml"],
      }),
    )
    await writeFile(
      nestedPath,
      JSON.stringify({
        apiVersion: "astrail.dev/v1alpha1",
        metadata: { name: "nested", version: "1.0.0" },
        requires: { astrail: ">=98.0.0" },
      }),
    )
    const loaded = await loadWorkspace({ cwd: root, astrailVersion: "0.3.0" })
    expect(loaded.effective.requires).toEqual({ astrail: "*" })
    expect(
      loaded.diagnostics
        .filter((item) => item.code === "ASTR1202")
        .map((item) => item.location?.file),
    ).toEqual([await realpath(basePath), await realpath(nestedPath)])
    expect(loaded.runtime.requirements).toHaveLength(3)
    expect(loaded.runtime.supported).toBe(false)
  })

  it("does not let a local overlay weaken the shared requirement", async () => {
    const root = await fixture({ astrail: ">=99.0.0" })
    await writeFile(
      join(root, "astrail.local.yaml"),
      JSON.stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "WorkspaceLocal",
        requires: { astrail: "*" },
      }),
    )
    const inspection = await inspectWorkspaceRuntime({ cwd: root })
    expect(inspection.success).toBe(false)
    expect(inspection.diagnostics[0]?.code).toBe("ASTR1202")
  })

  it("refuses to infer compatibility from malformed YAML", async () => {
    const root = await fixture()
    await writeFile(join(root, "astrail.yaml"), "requires: { astr ail: [\n")
    const inspected = await inspectWorkspaceRuntime({ cwd: root })
    expect(inspected.success).toBe(false)
    expect(inspected.data.runtime.supported).toBe(false)
  })

  it("reports version compatibility through doctor", async () => {
    const root = await fixture({ astrail: ">=0.3.0 <0.4.0" })
    const supported = await doctorWorkspace({ cwd: root, astrailVersion: "0.3.9" })
    expect(supported.data.tools).toMatchObject({ astrail: "0.3.9", astrailSupported: true })
    const unsupported = await doctorWorkspace({ cwd: root, astrailVersion: "0.2.0" })
    expect(unsupported.success).toBe(false)
    expect(unsupported.data.tools).toMatchObject({ astrail: "0.2.0", astrailSupported: false })
    expect(unsupported.diagnostics.some((item) => item.code === "ASTR1202")).toBe(true)
  })

  it("blocks bootstrap and lock writes through core APIs as well as the CLI", async () => {
    const root = await fixture({ astrail: ">=99.0.0" })
    const workspace = await resolveWorkspace({ cwd: root })
    const bootstrap = await planBootstrap(workspace)
    expect(bootstrap.actions).toEqual([])
    expect((await applyBootstrap(workspace, bootstrap, { authorized: true })).success).toBe(false)
    for (const plan of [await planLock(workspace), await planUpdate(workspace)]) {
      expect(plan.actions).toEqual([])
      expect((await applyFilePlan(root, plan, { authorized: true })).success).toBe(false)
    }
    expect(await pathExists(join(root, "astrail.lock.yaml"))).toBe(false)
    expect(await pathExists(join(root, ".astrail"))).toBe(false)
  })
})
