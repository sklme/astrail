import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parse, stringify } from "yaml"
import { configIntegrity, configManifestPath } from "./config-source.js"
import { pathExists } from "./fs.js"
import { applyBootstrap, applyFilePlan, planBootstrap, planLock } from "./lifecycle.js"
import { parseConfigText } from "./manifest.js"
import { resolveWorkspace } from "./resolver.js"

const manifest = `apiVersion: astrail.dev/v1alpha1
metadata: { name: example/logs, version: 1.0.0 }
setup: { mode: none }
`
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function fixture(body = manifest, status = 200) {
  const root = await mkdtemp(join(tmpdir(), "astrail-http-"))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const state = { body, status, hits: 0, location: "" }
  const server = createServer((_req, res) => {
    state.hits++
    res.writeHead(state.status, {
      "content-type": "application/yaml",
      ...(state.location ? { location: state.location } : {}),
    })
    res.end(state.body)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  cleanup.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing test server")
  const url = `http://127.0.0.1:${address.port}/v1.yaml`
  const reference = { http: url }
  const config = {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "test" },
    extends: [reference],
  }
  await writeFile(join(root, "astrail.yaml"), stringify(config))
  const cache = configManifestPath(root, { type: "http", url })
  const bootstrap = async () => {
    const workspace = await resolveWorkspace({ cwd: root })
    return applyBootstrap(workspace, await planBootstrap(workspace), { authorized: true })
  }
  return { root, state, config, url, cache, bootstrap }
}

describe("HTTP config acquisition", () => {
  it("keeps inspection, preview and unauthorized bootstrap offline, then caches validated content", async () => {
    const f = await fixture()
    const workspace = await resolveWorkspace({ cwd: f.root })
    expect(workspace.configs).toMatchObject([
      { available: false, source: { type: "http", url: f.url } },
    ])
    const plan = await planBootstrap(workspace)
    expect(plan.actions).toMatchObject([
      { type: "acquire", target: f.cache, requiresAuthorization: true },
    ])
    expect((await applyBootstrap(workspace, plan, { dryRun: true })).success).toBe(true)
    expect((await applyBootstrap(workspace, plan, {})).success).toBe(false)
    expect(f.state.hits).toBe(0)
    expect(await pathExists(join(f.root, ".astrail"))).toBe(false)
    expect((await f.bootstrap()).success).toBe(true)
    expect(await readFile(f.cache, "utf8")).toBe(manifest)
    const resolved = await resolveWorkspace({ cwd: f.root })
    expect(resolved.configs).toMatchObject([
      { available: true, integrity: configIntegrity(manifest) },
    ])
    expect(resolved.configSetups).toEqual([])
    expect((await f.bootstrap()).success).toBe(true)
    expect(f.state.hits).toBe(1)
  })

  it.each([
    ["HTTP failure", manifest, 503],
    ["login page", "<!doctype html><html>Login</html>", 200],
    ["malformed YAML", "metadata: [", 200],
    ["invalid schema", `${manifest}kind: Distribution\n`, 200],
    [
      "adjacent Skill",
      `${manifest}capabilities:\n  bad: { kind: skill, identity: example/bad, source: { type: config, path: skills/bad } }\n`,
      200,
    ],
    [
      "invalid capability",
      `${manifest}capabilities:\n  bad: { kind: unknown, identity: example/bad, source: { type: git, url: https://example.invalid/repo.git } }\n`,
      200,
    ],
    ["unsupported runtime", `${manifest}requires: { astrail: '>=999.0.0' }\n`, 200],
    ["oversized response", "x".repeat(1024 * 1024 + 1), 200],
  ])("rejects %s without publishing cache and permits retry", async (_name, text, status) => {
    const f = await fixture(text, status)
    expect((await f.bootstrap()).success).toBe(false)
    expect(await pathExists(f.cache)).toBe(false)
    f.state.body = manifest
    f.state.status = 200
    expect((await f.bootstrap()).success).toBe(true)
  })

  it("preserves a UTF-8 BOM when validating the published file digest", async () => {
    const text = `\uFEFF${manifest}`
    const f = await fixture(text)
    const source = {
      ...f.config.extends[0],
      integrity: configIntegrity(text),
    }
    await writeFile(
      join(f.root, "astrail.yaml"),
      stringify({
        ...f.config,
        extends: [source],
      }),
    )
    expect((await f.bootstrap()).success).toBe(true)
    expect(await readFile(f.cache, "utf8")).toBe(text)
  })

  it("enforces explicit integrity before publishing", async () => {
    const f = await fixture()
    const source = {
      ...f.config.extends[0],
      integrity: configIntegrity("different"),
    }
    await writeFile(
      join(f.root, "astrail.yaml"),
      stringify({
        ...f.config,
        extends: [source],
      }),
    )
    expect((await f.bootstrap()).diagnostics.some((item) => item.code === "ASTR1104")).toBe(true)
    expect(await pathExists(f.cache)).toBe(false)
  })

  it("records lock URL/digest, rejects changed cache and downloads, and separates changed URLs", async () => {
    const f = await fixture()
    await f.bootstrap()
    const workspace = await resolveWorkspace({ cwd: f.root })
    const lock = await planLock(workspace)
    await applyFilePlan(f.root, lock, {})
    const locked = parse(await readFile(join(f.root, "astrail.lock.yaml"), "utf8"))
    expect(locked.configs[workspace.configs[0]?.key ?? ""]).toMatchObject({
      source: { type: "http", url: f.url },
      integrity: configIntegrity(manifest),
    })
    expect(
      (await resolveWorkspace({ cwd: f.root })).diagnostics.filter(
        (item) => item.severity === "error",
      ),
    ).toEqual([])
    await writeFile(f.cache, `${manifest}# changed\n`)
    expect((await f.bootstrap()).diagnostics.some((item) => item.code === "ASTR1104")).toBe(true)
    await rm(f.cache)
    f.state.body = `${manifest}# changed\n`
    expect((await f.bootstrap()).success).toBe(false)
    expect(await pathExists(f.cache)).toBe(false)
    f.config.extends = [{ http: f.url.replace("v1", "v2") }]
    await writeFile(join(f.root, "astrail.yaml"), stringify(f.config))
    expect((await f.bootstrap()).success).toBe(true)
    const next = await resolveWorkspace({ cwd: f.root })
    expect(next.configs[0]?.manifestPath).not.toBe(f.cache)
    expect(next.diagnostics.filter((item) => item.severity === "error")).toEqual([])
  })

  it("bounds redirects and refuses credential-bearing redirect URLs", async () => {
    const f = await fixture(manifest, 302)
    f.state.location = f.url
    expect((await f.bootstrap()).success).toBe(false)
    expect(f.state.hits).toBe(6)
    f.state.location = f.url.replace("http://", "http://user:password@")
    expect((await f.bootstrap()).success).toBe(false)
    expect(await pathExists(f.cache)).toBe(false)
  })

  it("rejects adjacent resource and local config dependencies", () => {
    for (const fragment of [
      "contexts: { guide: { kind: file, path: guide.md } }",
      "extends: [./base.yaml]",
      "capabilities: { setup: { kind: skill, identity: example/setup, source: { type: workspace, path: skills/setup } } }",
    ])
      expect(
        parseConfigText(
          `${manifest}${fragment}\n`,
          "https://example.invalid/v1.yaml",
          true,
        ).diagnostics.some((item) => item.code === "ASTR1113"),
      ).toBe(true)
  })

  it("resolves setup by canonical identity after alias overrides and diagnoses missing or inactive Skills", async () => {
    const f =
      await fixture(`${manifest.replace("{ mode: none }", "{ mode: skill, skill: example/setup }")}capabilities:
  setup:
    kind: skill
    identity: example/setup
    exposeAs: original-name
    source: { type: git, url: https://example.invalid/skills.git, revision: { tag: v1 }, path: skills/setup }
    trust: { instructions: trusted }
`)
    await f.bootstrap()
    const config = {
      ...f.config,
      capabilities: { setup: { kind: "skill", identity: "example/setup", exposeAs: "my-setup" } },
    }
    await writeFile(join(f.root, "astrail.yaml"), stringify(config))
    const workspace = await resolveWorkspace({ cwd: f.root })
    expect(workspace.configSetups).toMatchObject([
      { skill: "example/setup", alias: "my-setup", status: "pending" },
    ])
    await writeFile(
      join(f.root, "astrail.yaml"),
      stringify({
        ...config,
        capabilities: {
          setup: { ...config.capabilities.setup, trust: { instructions: "disabled" } },
        },
      }),
    )
    expect((await resolveWorkspace({ cwd: f.root })).configSetups[0]?.status).toBe("blocked")
    await writeFile(
      join(f.root, "astrail.yaml"),
      stringify({
        ...config,
        capabilities: { setup: { ...config.capabilities.setup, disabled: true } },
      }),
    )
    expect(
      (await resolveWorkspace({ cwd: f.root })).diagnostics.some(
        (item) => item.code === "ASTR1114" && item.severity === "error",
      ),
    ).toBe(true)
  })

  it("allows local shared configs without setup", async () => {
    const f = await fixture()
    const path = join(f.root, "local", "astrail.config.yaml")
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, manifest.replace("setup: { mode: none }\n", ""))
    await writeFile(
      join(f.root, "astrail.yaml"),
      stringify({
        ...f.config,
        extends: ["./local/astrail.config.yaml"],
      }),
    )
    const workspace = await resolveWorkspace({ cwd: f.root })
    expect(workspace.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(workspace.diagnostics).toEqual([])
    expect(workspace.configSetups).toEqual([])
    expect(f.state.hits).toBe(0)
  })
})
