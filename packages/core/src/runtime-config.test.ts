import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadWorkspace } from "./manifest.js"
import { readRuntimePreference, userRuntimeConfigPath } from "./runtime-config.js"

let root: string
let user: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "astrail-runtime-config-"))
  user = join(root, "user.yaml")
  vi.stubEnv("ASTRAIL_USER_CONFIG", user)
  await writeFile(
    join(root, "astrail.yaml"),
    "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: test }\n",
  )
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe("runtime preferences", () => {
  it("preserves legacy selection when no mode is declared", async () => {
    expect(await readRuntimePreference(root)).toEqual({ mode: "auto" })
  })

  it("resolves local overlay before workspace before user and exposes the winning source", async () => {
    await writeFile(user, "runtime: { mode: global }\n")
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.runtime).toMatchObject({ mode: "global", modeSource: user })
    expect(loaded.effective.runtime).toEqual({ mode: "global" })
    expect(loaded.provenance["/runtime/mode"]?.at(-1)?.source).toBe(user)
    await writeFile(
      join(root, "custom.yaml"),
      "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: test }\nruntime: { mode: local }\n",
    )
    expect(await readRuntimePreference(root, join(root, "custom.yaml"))).toEqual({
      mode: "local",
      source: join(root, "custom.yaml"),
    })
    await writeFile(
      join(root, "astrail.local.yaml"),
      "apiVersion: astrail.dev/v1alpha1\nkind: WorkspaceLocal\nruntime: { mode: global }\n",
    )
    const overridden = await loadWorkspace({ cwd: root, config: "custom.yaml" })
    expect(overridden.diagnostics).toEqual([])
    expect(overridden.runtime).toMatchObject({
      mode: "global",
      modeSource: join(root, "astrail.local.yaml"),
    })
  })

  it("uses XDG preferences when no explicit user config path is set", async () => {
    vi.stubEnv("ASTRAIL_USER_CONFIG", "")
    vi.stubEnv("XDG_CONFIG_HOME", join(root, "xdg"))
    await mkdir(join(root, "xdg/astrail"), { recursive: true })
    await writeFile(userRuntimeConfigPath(), "runtime: { mode: global }\n")
    expect((await readRuntimePreference(root)).mode).toBe("global")
  })

  it.each([
    "runtime: { mode: latest }",
    "runtime: {}",
    "runtime: null",
    "runtime: { mode: global, executable: danger }",
    "runtime: { mode: global, mode: local }",
    "[global]",
  ])("rejects invalid preferences without executing another CLI: %s", async (text) => {
    await writeFile(user, text)
    await expect(readRuntimePreference(root)).rejects.toThrow()
  })

  it("does not allow acquired configs to select a runtime", async () => {
    await writeFile(join(root, "base.yaml"), "runtime: { mode: global }\n")
    await writeFile(
      join(root, "astrail.yaml"),
      "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: test }\nextends: [./base.yaml]\n",
    )
    expect((await readRuntimePreference(root)).mode).toBe("auto")
    expect(
      (await loadWorkspace({ cwd: root })).diagnostics.some((item) => item.severity === "error"),
    ).toBe(true)
  })
})
