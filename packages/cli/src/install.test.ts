import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathExists, resolveWorkspace, runProcess } from "astrail-core"
import { afterEach, describe, expect, it } from "vitest"
import { parse, stringify } from "yaml"
import { createProgram } from "./program.js"

const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []
const initialExitCode = process.exitCode
afterEach(async () => {
  process.exitCode = initialExitCode
  for (const cleanup of cleanups.splice(0)) await cleanup()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "astrail-install-"))
  roots.push(root)
  return root
}
async function git(root: string, ...args: string[]) {
  const value = await runProcess("git", ["-C", root, ...args])
  expect(value.exitCode, value.stderr).toBe(0)
  return value.stdout.trim()
}
async function commit(root: string) {
  await git(root, "add", ".")
  await git(
    root,
    "-c",
    "user.name=Install Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture",
  )
  return git(root, "rev-parse", "HEAD")
}
async function yaml(root: string, path: string, value: unknown) {
  await writeFile(join(root, path), stringify(value))
}
async function manifest(root: string, fields: Record<string, unknown> = {}) {
  await yaml(root, "astrail.yaml", {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "install-test" },
    ...fields,
  })
}
async function cli(root: string, ...args: string[]) {
  const stdout: string[] = []
  await createProgram({ out: (value) => stdout.push(value), err: () => undefined }).parseAsync(
    ["--json", "--cwd", root, ...args],
    { from: "user" },
  )
  return JSON.parse(stdout.join(""))
}
async function succeeds(root: string, ...args: string[]) {
  const value = await cli(root, ...args)
  expect(value.success, JSON.stringify(value.diagnostics)).toBe(true)
  return value
}
async function sharedRemote() {
  const remote = await directory()
  await git(remote, "init", "-b", "main")
  await mkdir(join(remote, "skills", "example"), { recursive: true })
  await writeFile(join(remote, "skills", "example", "SKILL.md"), "# First\n")
  await yaml(remote, "astrail.config.yaml", {
    capabilities: {
      example: {
        identity: "team/example",
        kind: "skill",
        version: "1.0.0",
        source: { type: "config", path: "skills/example" },
      },
    },
  })
  return { remote, first: await commit(remote) }
}
const text = (root: string, path: string) => readFile(join(root, path), "utf8")
const lock = async (root: string) => parse(await text(root, "astrail.lock.yaml"))

describe("install and update lifecycle", () => {
  it.each(["install", "update", "bootstrap"])(
    "%s previews a changed Workspace Skill without treating the old lock as a declaration",
    async (command) => {
      const root = await directory()
      await mkdir(join(root, "skills", "example"), { recursive: true })
      await writeFile(join(root, "skills", "example", "SKILL.md"), "# First\n")
      await manifest(root, {
        policies: { projectionStrategy: "copy" },
        capabilities: {
          example: {
            identity: "team/example",
            kind: "skill",
            source: { type: "workspace", path: "skills/example" },
          },
        },
      })
      await succeeds(root, "install", "--yes")
      const initialLock = await text(root, "astrail.lock.yaml")
      await writeFile(join(root, "skills", "example", "SKILL.md"), "# Second\n")
      const preview = await succeeds(root, command, "--dry-run")
      expect(preview.data.lock.actions).toHaveLength(1)
      expect(await text(root, "astrail.lock.yaml")).toBe(initialLock)
      expect(await text(root, ".agents/skills/example/SKILL.md")).toBe("# First\n")
      await succeeds(root, command, "--yes")
      expect(await text(root, "astrail.lock.yaml")).not.toBe(initialLock)
      expect(await text(root, ".agents/skills/example/SKILL.md")).toBe("# Second\n")
    },
  )

  it("still rejects drift against an explicitly declared Skill integrity", async () => {
    const root = await directory()
    await mkdir(join(root, "skills", "example"), { recursive: true })
    await writeFile(join(root, "skills", "example", "SKILL.md"), "# First\n")
    const capability = {
      identity: "team/example",
      kind: "skill",
      source: { type: "workspace", path: "skills/example" },
    }
    await manifest(root, { capabilities: { example: capability } })
    await succeeds(root, "install", "--yes")
    const initialLock = await text(root, "astrail.lock.yaml")
    await manifest(root, {
      capabilities: {
        example: { ...capability, integrity: (await lock(root)).capabilities.example.integrity },
      },
    })
    await writeFile(join(root, "skills", "example", "SKILL.md"), "# Second\n")
    for (const command of ["install", "update"]) {
      const preview = await cli(root, command, "--dry-run")
      expect(preview.success).toBe(false)
      expect(preview.diagnostics).toContainEqual(expect.objectContaining({ code: "ASTR4004" }))
    }
    expect(await text(root, "astrail.lock.yaml")).toBe(initialLock)
  })

  it("installs and locks, preserves a moving default branch, restores its cache, then updates all managed state", async () => {
    const root = await directory()
    const { remote, first } = await sharedRemote()
    await manifest(root, { extends: [{ git: remote }] })
    const preview = await succeeds(root, "install", "--dry-run")
    expect(preview.data.bootstrap[0].actions[0].type).toBe("clone")
    expect(await pathExists(join(root, ".astrail"))).toBe(false)
    expect((await cli(root, "install")).success).toBe(false)
    await succeeds(root, "install", "--yes")
    const initialLock = await text(root, "astrail.lock.yaml")
    const config = (await resolveWorkspace({ cwd: root })).configs[0]
    expect(config?.resolvedCommit).toBe(first)
    expect(Object.values((await lock(root)).configs)).toEqual([
      expect.objectContaining({ resolvedCommit: first }),
    ])
    await writeFile(join(remote, "skills", "example", "SKILL.md"), "# Second\n")
    const second = await commit(remote)
    await succeeds(root, "install")
    expect(await text(root, "astrail.lock.yaml")).toBe(initialLock)
    expect(await text(root, ".agents/skills/example/SKILL.md")).toBe("# First\n")
    if (!config) throw new Error("Missing acquired config")
    await rm(dirname(config.manifestPath), { recursive: true, force: true })
    await succeeds(root, "install", "--yes")
    expect((await resolveWorkspace({ cwd: root })).configs[0]?.resolvedCommit).toBe(first)
    await succeeds(root, "update", "--yes")
    expect((await resolveWorkspace({ cwd: root })).configs[0]?.resolvedCommit).toBe(second)
    expect(await text(root, ".agents/skills/example/SKILL.md")).toBe("# Second\n")
    expect(Object.values((await lock(root)).previous.lock.configs)).toEqual([
      expect.objectContaining({ resolvedCommit: first }),
    ])
    const updatedLock = await text(root, "astrail.lock.yaml")
    await succeeds(root, "install")
    expect(await text(root, "astrail.lock.yaml")).toBe(updatedLock)
    await rename(remote, `${remote}-offline`)
    cleanups.push(() => rename(`${remote}-offline`, remote))
    await succeeds(root, "update", "--dry-run")
    expect((await cli(root, "update")).success).toBe(false)
    expect(await text(root, "astrail.lock.yaml")).toBe(updatedLock)
    await succeeds(root, "install")
  })

  it("restores direct Git Skills at the locked commit and updates branch Skills without changing their declaration", async () => {
    const root = await directory()
    const { remote, first } = await sharedRemote()
    await manifest(root, {
      capabilities: {
        direct: {
          identity: "team/direct",
          kind: "skill",
          trust: { instructions: "trusted" },
          source: {
            type: "git",
            url: remote,
            revision: { branch: "main" },
            path: "skills/example",
          },
        },
      },
    })
    await succeeds(root, "install", "--yes")
    const declaration = await text(root, "astrail.yaml")
    expect((await lock(root)).capabilities.direct.source.resolvedCommit).toBe(first)
    await writeFile(join(remote, "skills", "example", "SKILL.md"), "# New direct Skill\n")
    const second = await commit(remote)
    await rm(join(root, ".agents/skills/direct"), { recursive: true })
    await succeeds(root, "install", "--yes")
    expect(await text(root, ".agents/skills/direct/SKILL.md")).toBe("# First\n")
    expect((await lock(root)).capabilities.direct.source.resolvedCommit).toBe(first)
    await succeeds(root, "update", "--yes")
    expect(await text(root, ".agents/skills/direct/SKILL.md")).toBe("# New direct Skill\n")
    expect((await lock(root)).capabilities.direct.source.resolvedCommit).toBe(second)
    expect(await text(root, "astrail.yaml")).toBe(declaration)
  })

  it("keeps fixed tags locked for configs and direct Skills even if a tag is moved", async () => {
    const root = await directory()
    const { remote, first } = await sharedRemote()
    await git(remote, "tag", "v1")
    await manifest(root, {
      extends: [{ git: remote, ref: "v1" }],
      capabilities: {
        direct: {
          identity: "team/direct",
          kind: "skill",
          trust: { instructions: "trusted" },
          source: { type: "git", url: remote, revision: { tag: "v1" }, path: "skills/example" },
        },
      },
    })
    await succeeds(root, "install", "--yes")
    const before = await text(root, "astrail.lock.yaml")
    await writeFile(join(remote, "skills", "example", "SKILL.md"), "# Moved tag\n")
    await commit(remote)
    await git(remote, "tag", "-f", "v1")
    await succeeds(root, "update", "--yes")
    expect(await text(root, "astrail.lock.yaml")).toBe(before)
    expect((await resolveWorkspace({ cwd: root })).configs[0]?.resolvedCommit).toBe(first)
    expect(await text(root, ".agents/skills/direct/SKILL.md")).toBe("# First\n")
    await rename(remote, `${remote}-offline`)
    cleanups.push(() => rename(`${remote}-offline`, remote))
    await succeeds(root, "update")
    expect(await text(root, "astrail.lock.yaml")).toBe(before)
  })

  it("updates nested configs from the new parent graph without fetching removed dependencies", async () => {
    const root = await directory()
    const { remote: parent } = await sharedRemote()
    const { remote: child } = await sharedRemote()
    await yaml(parent, "astrail.config.yaml", { extends: [{ git: child }] })
    await commit(parent)
    await manifest(root, { extends: [{ git: parent }] })
    await succeeds(root, "install", "--yes")
    await yaml(parent, "astrail.config.yaml", { metadata: { name: "parent-without-child" } })
    await commit(parent)
    await rename(child, `${child}-offline`)
    cleanups.push(() => rename(`${child}-offline`, child))
    await succeeds(root, "update", "--yes")
    expect((await resolveWorkspace({ cwd: root })).configs).toHaveLength(1)
    expect((await lock(root)).capabilities).toEqual({})
    expect(await pathExists(join(root, ".agents/skills/example"))).toBe(false)
  })

  it("rolls back refreshed caches, lock and projections if a later Skill acquisition fails", async () => {
    const root = await directory()
    const { remote, first } = await sharedRemote()
    await manifest(root, { extends: [{ git: remote }] })
    await succeeds(root, "install", "--yes")
    const before = await text(root, "astrail.lock.yaml")
    const projection = await text(root, ".astrail/projection-manifest.json")
    const agents = await text(root, "AGENTS.md")
    await writeFile(join(remote, "skills/example/SKILL.md"), "# Should roll back\n")
    const config = parse(await text(remote, "astrail.config.yaml"))
    config.capabilities.broken = {
      identity: "team/broken",
      kind: "skill",
      trust: { instructions: "trusted" },
      source: {
        type: "git",
        url: join(root, "missing-remote"),
        revision: { branch: "main" },
        path: "skills/broken",
      },
    }
    await yaml(remote, "astrail.config.yaml", config)
    await commit(remote)
    const failed = await cli(root, "update", "--yes")
    expect(failed.success).toBe(false)
    expect(failed.data.rolledBack).toBe(true)
    expect(await text(root, "astrail.lock.yaml")).toBe(before)
    expect(await text(root, ".astrail/projection-manifest.json")).toBe(projection)
    expect(await text(root, "AGENTS.md")).toBe(agents)
    expect(await text(root, ".agents/skills/example/SKILL.md")).toBe("# First\n")
    expect((await resolveWorkspace({ cwd: root })).configs[0]?.resolvedCommit).toBe(first)
  })

  it("rejects an invalid refreshed config without replacing the working cache", async () => {
    const root = await directory()
    const { remote, first } = await sharedRemote()
    await manifest(root, { extends: [{ git: remote }] })
    await succeeds(root, "install", "--yes")
    await writeFile(join(remote, "astrail.config.yaml"), "unknownConfigField: true\n")
    await commit(remote)
    expect((await cli(root, "update", "--yes")).success).toBe(false)
    expect((await resolveWorkspace({ cwd: root })).configs[0]?.resolvedCommit).toBe(first)
    await succeeds(root, "install")
  })

  it("restores an already replaced Git Skill when editor synchronization fails later", async () => {
    const root = await directory()
    const { remote, first } = await sharedRemote()
    await manifest(root, {
      capabilities: {
        direct: {
          identity: "team/direct",
          kind: "skill",
          trust: { instructions: "trusted" },
          source: {
            type: "git",
            url: remote,
            revision: { branch: "main" },
            path: "skills/example",
          },
        },
      },
    })
    await succeeds(root, "install", "--yes")
    const beforeLock = await text(root, "astrail.lock.yaml")
    const beforeProjection = await text(root, ".astrail/projection-manifest.json")
    await writeFile(join(root, "install-test.code-workspace"), "invalid JSON")
    await writeFile(join(remote, "skills/example/SKILL.md"), "# New content\n")
    await commit(remote)
    const failed = await cli(root, "update", "--yes")
    expect(failed.success).toBe(false)
    expect(failed.diagnostics.some((item: { code: string }) => item.code === "ASTR7403")).toBe(true)
    expect(await text(root, ".agents/skills/direct/SKILL.md")).toBe("# First\n")
    expect(await text(root, "astrail.lock.yaml")).toBe(beforeLock)
    expect(await text(root, ".astrail/projection-manifest.json")).toBe(beforeProjection)
    expect((await lock(root)).capabilities.direct.source.resolvedCommit).toBe(first)
    expect(await text(root, "install-test.code-workspace")).toBe("invalid JSON")
  })

  it("installs changed config refs without inheriting obsolete capability digests", async () => {
    const root = await directory()
    const { remote } = await sharedRemote()
    await git(remote, "tag", "v1")
    await manifest(root, { extends: [{ git: remote, ref: "v1" }] })
    await succeeds(root, "install", "--yes")
    await writeFile(join(remote, "skills/example/SKILL.md"), "# Next tag\n")
    const second = await commit(remote)
    await git(remote, "tag", "v2")
    await manifest(root, { extends: [{ git: remote, ref: "v2" }] })
    await succeeds(root, "install", "--yes")
    expect(await text(root, ".agents/skills/example/SKILL.md")).toBe("# Next tag\n")
    expect(Object.values((await lock(root)).configs)).toEqual([
      expect.objectContaining({ resolvedCommit: second }),
    ])
    await succeeds(root, "status")
  })

  it("does not replace a locally modified Git config cache during update", async () => {
    const root = await directory()
    const { remote } = await sharedRemote()
    await manifest(root, { extends: [{ git: remote }] })
    await succeeds(root, "install", "--yes")
    const config = (await resolveWorkspace({ cwd: root })).configs[0]
    if (!config) throw new Error("Missing config")
    await writeFile(join(dirname(config.manifestPath), "skills/example/SKILL.md"), "# Local edit\n")
    const failed = await cli(root, "update", "--yes")
    expect(failed.success).toBe(false)
    expect(failed.diagnostics.some((item: { code: string }) => item.code === "ASTR1104")).toBe(true)
    expect(await text(root, ".agents/skills/example/SKILL.md")).toBe("# Local edit\n")
  })

  it("maintains locks after declaration edits and preserves business checkout changes", async () => {
    const root = await directory()
    const { remote } = await sharedRemote()
    await manifest(root, {
      repositories: { app: { access: "read-write", source: { type: "git", url: remote } } },
      capabilities: {
        example: {
          identity: "team/example",
          kind: "skill",
          source: { type: "repository", repository: "app", path: "skills/example" },
          trust: { instructions: "trusted" },
        },
      },
    })
    await succeeds(root, "install", "--yes")
    await writeFile(join(root, "repos/app/skills/example/SKILL.md"), "# Local work\n")
    const branch = await git(join(root, "repos/app"), "branch", "--show-current")
    await succeeds(root, "install")
    await succeeds(root, "update")
    expect(await text(root, "repos/app/skills/example/SKILL.md")).toBe("# Local work\n")
    expect(await git(join(root, "repos/app"), "branch", "--show-current")).toBe(branch)
    const config = parse(await text(root, "astrail.yaml"))
    delete config.capabilities
    await yaml(root, "astrail.yaml", config)
    await succeeds(root, "install")
    expect((await lock(root)).capabilities).toEqual({})
    expect(await pathExists(join(root, ".agents/skills/example"))).toBe(false)
  })

  it("keeps bootstrap as an install alias and sync as a projection-only compatibility command", async () => {
    const root = await directory()
    await manifest(root)
    await succeeds(root, "sync")
    expect(await pathExists(join(root, "astrail.lock.yaml"))).toBe(false)
    await succeeds(root, "bootstrap")
    expect(await pathExists(join(root, "astrail.lock.yaml"))).toBe(true)
    const before = await text(root, "astrail.lock.yaml")
    await succeeds(root, "install")
    expect(await text(root, "astrail.lock.yaml")).toBe(before)
    await succeeds(root, "update", "--restore", "--dry-run")
    expect(await text(root, "astrail.lock.yaml")).toBe(before)
  })

  it("refreshes HTTP content and locks its new digest, with offline dry-run and failed-update recovery", async () => {
    const root = await directory()
    let content = stringify({ metadata: { name: "first" } })
    let hits = 0
    const server = createServer((_request, response) => {
      hits++
      response.end(content)
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing port")
    await manifest(root, { extends: [`http://127.0.0.1:${address.port}/config.yaml`] })
    await succeeds(root, "install", "--yes")
    const first = await text(root, "astrail.lock.yaml")
    content = stringify({ metadata: { name: "second" } })
    await succeeds(root, "install")
    await succeeds(root, "update", "--dry-run")
    expect(hits).toBe(1)
    await succeeds(root, "update", "--yes")
    expect(hits).toBe(2)
    const second = await text(root, "astrail.lock.yaml")
    expect(second).not.toBe(first)
    content = "invalidField: true\n"
    expect((await cli(root, "update", "--yes")).success).toBe(false)
    expect(await text(root, "astrail.lock.yaml")).toBe(second)
    await succeeds(root, "install")
  })
})
