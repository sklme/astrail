import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parse, stringify } from "yaml"
import { configCacheRoot } from "./config-source.js"
import { pathExists } from "./fs.js"
import { applyBootstrap, applyFilePlan, planBootstrap, planLock } from "./lifecycle.js"
import { loadWorkspace } from "./manifest.js"
import { runProcess } from "./process.js"
import { resolveWorkspace } from "./resolver.js"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(extra: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "astrail-config-test-")))
  roots.push(root)
  await yaml(root, "astrail.yaml", {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "consumer" },
    ...extra,
  })
  return root
}
async function yaml(root: string, file: string, value: unknown) {
  await mkdir(dirname(join(root, file)), { recursive: true })
  await writeFile(join(root, file), stringify(value))
}
async function git(root: string, ...args: string[]) {
  const result = await runProcess("git", ["-C", root, ...args])
  expect(result.exitCode, result.stderr).toBe(0)
  return result.stdout.trim()
}
async function commit(root: string) {
  await git(root, "add", ".")
  await git(
    root,
    "-c",
    "user.name=Astrail Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture",
  )
  return git(root, "rev-parse", "HEAD")
}
async function bootstrap(root: string) {
  const workspace = await resolveWorkspace({ cwd: root })
  return applyBootstrap(workspace, await planBootstrap(workspace), { authorized: true })
}

describe("shared configuration graph", () => {
  it("diagnoses a malformed source lock without attempting to resolve invalid coordinates", async () => {
    const root = await fixture({ extends: ["./base.yaml"] })
    await yaml(root, "base.yaml", { policies: { strict: true } })
    const workspace = await resolveWorkspace({ cwd: root })
    const key = workspace.configs[0]?.key
    if (!key) throw new Error("Missing config key")
    await yaml(root, "astrail.lock.yaml", {
      apiVersion: "astrail.dev/v1alpha1",
      kind: "WorkspaceLock",
      workspace: "consumer",
      resolvedAt: new Date().toISOString(),
      configs: { [key]: { source: { type: "local" }, integrity: workspace.configs[0]?.integrity } },
    })
    expect(
      (await loadWorkspace({ cwd: root })).diagnostics.some((item) => item.code === "ASTR1005"),
    ).toBe(true)
  })

  it("resolves partial local repository paths from the config that supplies the winning path", async () => {
    const root = await fixture({ extends: ["./team/config.yaml"] })
    await yaml(root, "base.yaml", {
      repositories: { linked: { access: "read-write", source: { type: "local", path: "old" } } },
    })
    await yaml(root, "team/config.yaml", {
      extends: ["../base.yaml"],
      repositories: { linked: { source: { path: "../linked" } } },
    })
    const workspace = await resolveWorkspace({ cwd: root })
    expect(workspace.diagnostics).toEqual([])
    expect(workspace.topology.repositories[0]?.path).toBe(join(root, "linked"))
  })

  it("does not write an incomplete config lock", async () => {
    const root = await fixture({ extends: [{ git: "https://example.invalid/config.git" }] })
    const plan = await planLock(await resolveWorkspace({ cwd: root }))
    expect(plan.diagnostics.some((item) => item.code === "ASTR6204")).toBe(true)
    expect((await applyFilePlan(root, plan, {})).success).toBe(false)
    expect(await pathExists(join(root, "astrail.lock.yaml"))).toBe(false)
  })
  it("merges fragments depth first, deduplicates diamonds, replaces arrays, and retains declaring paths", async () => {
    const root = await fixture({
      extends: ["./team.yaml", "./other.yaml"],
      contexts: { guide: { priority: 9 } },
    })
    await yaml(root, "base/config.yaml", {
      metadata: { name: "optional description" },
      contexts: { guide: { kind: "file", path: "guide.md", priority: 1 } },
      environments: { dev: { repositories: ["one"], checkout: { branch: "main" } } },
      repositories: {
        one: {
          access: "read-write",
          source: { type: "git", url: "https://example.invalid/one.git" },
        },
        two: {
          access: "read-write",
          source: { type: "git", url: "https://example.invalid/two.git" },
        },
      },
    })
    await yaml(root, "team.yaml", {
      extends: ["./base/config.yaml"],
      contexts: { guide: { priority: 2 } },
    })
    await yaml(root, "other.yaml", {
      extends: ["./base/config.yaml"],
      environments: { dev: { repositories: ["two"] } },
    })
    const loaded = await loadWorkspace({ cwd: root })
    expect(loaded.diagnostics).toEqual([])
    expect(loaded.configs.map((item) => item.manifestPath)).toEqual(
      ["base/config.yaml", "team.yaml", "other.yaml"].map((file) => join(root, file)),
    )
    expect(loaded.effective.metadata.name).toBe("consumer")
    expect(loaded.effective.contexts?.guide).toMatchObject({
      kind: "file",
      path: "guide.md",
      priority: 9,
    })
    expect(loaded.effective.environments?.dev?.repositories).toEqual(["two"])
    expect((await resolveWorkspace({ cwd: root })).contexts[0]?.location).toBe(
      join(root, "base/guide.md"),
    )
  })

  it("keeps independent setup entries in dependency order and the Workspace setup last", async () => {
    const root = await fixture({
      extends: ["./team.yaml"],
      setup: { mode: "skill", skill: "test/root" },
      capabilities: {
        logging: { exposeAs: "my-logs" },
        root: { kind: "skill", identity: "test/root", source: { type: "builtin" } },
      },
    })
    await yaml(root, "team.yaml", { extends: ["./logs.yaml", "./deploy.yaml", "./logs.yaml"] })
    for (const [file, id] of [
      ["logs", "logging"],
      ["deploy", "deployment"],
    ] as const) {
      await yaml(root, `${file}.yaml`, {
        setup: { mode: "skill", skill: `test/${id}` },
        capabilities: {
          [id]: { kind: "skill", identity: `test/${id}`, source: { type: "builtin" } },
        },
      })
    }
    const workspace = await resolveWorkspace({ cwd: root })
    expect(workspace.diagnostics).toEqual([])
    expect(workspace.configSetups).toMatchObject([
      { config: join(root, "logs.yaml"), skill: "test/logging", alias: "my-logs" },
      { config: join(root, "deploy.yaml"), skill: "test/deployment", alias: "deployment" },
      { config: join(root, "astrail.yaml"), skill: "test/root", alias: "root" },
    ])
  })

  it("reports cycles, missing local files, conflicting Git refs, and removed syntax", async () => {
    const root = await fixture({
      extends: [
        "./a.yaml",
        "./missing.yaml",
        { git: "https://example.invalid/config.git", ref: "v1" },
        { git: "https://example.invalid/config.git", ref: "v2" },
      ],
    })
    await yaml(root, "a.yaml", { extends: ["./b.yaml"] })
    await yaml(root, "b.yaml", { extends: ["./a.yaml"] })
    expect((await loadWorkspace({ cwd: root })).diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ASTR1105", "ASTR1102", "ASTR1106"]),
    )
    await yaml(root, "a.yaml", { kind: "Distribution", defaults: { policies: { strict: true } } })
    expect(
      (await loadWorkspace({ cwd: root })).diagnostics.some((item) => item.code === "ASTR1005"),
    ).toBe(true)
  })

  it("requires complete entities after composition and allows pending remote overrides to be acquired", async () => {
    const root = await fixture({
      extends: [{ git: "https://example.invalid/config.git" }],
      capabilities: { setup: { exposeAs: "mine" } },
    })
    const pending = await resolveWorkspace({ cwd: root })
    expect(pending.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect((await planBootstrap(pending)).actions).toHaveLength(1)
    await yaml(root, "astrail.yaml", {
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "consumer" },
      capabilities: { setup: { exposeAs: "mine" } },
    })
    expect(
      (await resolveWorkspace({ cwd: root })).diagnostics.some(
        (item) => item.code === "ASTR1010" && item.severity === "error",
      ),
    ).toBe(true)
  })

  it("keeps local locks portable and checks their content after relocation", async () => {
    const root = await fixture({ extends: ["./base.yaml"] })
    await yaml(root, "base.yaml", { policies: { strict: true } })
    await applyFilePlan(root, await planLock(await resolveWorkspace({ cwd: root })), {})
    const lock = parse(await readFile(join(root, "astrail.lock.yaml"), "utf8"))
    expect(Object.values(lock.configs)).toMatchObject([
      { source: { type: "local", path: "base.yaml" } },
    ])
    const relocated = await fixture()
    await cp(root, relocated, { recursive: true })
    expect((await loadWorkspace({ cwd: relocated })).diagnostics).toEqual([])
    await yaml(relocated, "base.yaml", { policies: { strict: false } })
    expect(
      (await loadWorkspace({ cwd: relocated })).diagnostics.some(
        (item) => item.code === "ASTR1104",
      ),
    ).toBe(true)
  })
})

describe("Git config acquisition", () => {
  it("validates nested config requirements before publishing the checkout", async () => {
    const remote = await fixture()
    await git(remote, "init", "-b", "main")
    await yaml(remote, "astrail.config.yaml", { extends: ["./future.yaml"] })
    await yaml(remote, "future.yaml", { requires: { astrail: ">=999.0.0" } })
    await commit(remote)
    const root = await fixture({ extends: [{ git: remote }] })
    const source = (await resolveWorkspace({ cwd: root })).configs[0]?.source
    if (!source) throw new Error("Missing config source")
    const result = await bootstrap(root)
    expect(result.diagnostics.some((item) => item.code === "ASTR1202")).toBe(true)
    expect(await pathExists(configCacheRoot(root, source))).toBe(false)
  })
  it("uses one checkout for relative nested configs and restores the locked commit after the branch moves", async () => {
    const remote = await fixture()
    await git(remote, "init", "-b", "main")
    await yaml(remote, "configs/team.yaml", {
      extends: ["./base.yaml"],
      policies: { strict: true },
    })
    await yaml(remote, "configs/base.yaml", {
      contexts: { guide: { kind: "file", path: "../guide.md" } },
    })
    await writeFile(join(remote, "guide.md"), "guide\n")
    const revision = await commit(remote)
    const root = await fixture({
      extends: [{ git: remote, ref: "main", path: "configs/team.yaml" }],
    })
    expect((await bootstrap(root)).success).toBe(true)
    const resolved = await resolveWorkspace({ cwd: root })
    expect(resolved.diagnostics).toEqual([])
    expect(resolved.configs).toHaveLength(2)
    const cache = configCacheRoot(
      root,
      resolved.configs[0]?.source ?? { type: "local", path: root },
    )
    expect(resolved.contexts[0]?.location).toBe(join(cache, "guide.md"))
    expect(new Set(resolved.configs.map((item) => configCacheRoot(root, item.source))).size).toBe(1)
    await applyFilePlan(root, await planLock(resolved), {})
    await writeFile(join(cache, "guide.md"), "changed resource\n")
    expect(
      (await resolveWorkspace({ cwd: root })).diagnostics.some((item) => item.code === "ASTR1104"),
    ).toBe(true)
    await yaml(remote, "configs/team.yaml", { policies: { strict: false } })
    await commit(remote)
    await rm(cache, { recursive: true })
    expect((await bootstrap(root)).success).toBe(true)
    const restored = await resolveWorkspace({ cwd: root })
    expect(restored.configs.every((item) => item.resolvedCommit === revision)).toBe(true)
    expect(restored.config.policies?.strict).toBe(true)
  })

  it.each(["../outside.yaml", "/tmp/outside.yaml", ".git/config"])(
    "rejects unsafe entry %s without writing a checkout",
    async (path) => {
      const root = await fixture({ extends: [{ git: "https://example.invalid/config.git", path }] })
      const workspace = await resolveWorkspace({ cwd: root })
      expect(workspace.diagnostics.some((item) => item.severity === "error")).toBe(true)
      expect((await planBootstrap(workspace)).actions).toEqual([])
      expect(await pathExists(join(root, ".astrail"))).toBe(false)
    },
  )

  it("rejects symlink escapes before publishing a checkout and allows a corrected source to retry", async () => {
    const remote = await fixture()
    await git(remote, "init", "-b", "main")
    await yaml(remote, "astrail.config.yaml", {
      contexts: { guide: { kind: "file", path: "outside/guide.md" } },
    })
    await symlink(tmpdir(), join(remote, "outside"))
    await commit(remote)
    const root = await fixture({ extends: [{ git: remote }] })
    const initial = await resolveWorkspace({ cwd: root })
    const cache = configCacheRoot(root, initial.configs[0]?.source ?? { type: "local", path: root })
    expect((await bootstrap(root)).success).toBe(false)
    expect(await pathExists(cache)).toBe(false)
    await yaml(remote, "astrail.config.yaml", { policies: { strict: true } })
    await commit(remote)
    expect((await bootstrap(root)).success).toBe(true)
  })
})
