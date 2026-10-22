import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathExists, runProcess } from "astrail-core"
import { afterEach, describe, expect, it } from "vitest"
import { stringify } from "yaml"
import { createProgram } from "./program.js"

const cleanups: Array<() => Promise<void>> = []
const originalExitCode = process.exitCode
afterEach(async () => {
  process.exitCode = originalExitCode
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function command(root: string, args: string[], json = true) {
  const stdout: string[] = []
  const stderr: string[] = []
  await createProgram({
    out: (value) => stdout.push(value),
    err: (value) => stderr.push(value),
  }).parseAsync([...(json ? ["--json"] : []), "--cwd", root, ...args], { from: "user" })
  return {
    text: stdout.join(""),
    errors: stderr.join(""),
    data: json ? JSON.parse(stdout.join("")) : undefined,
  }
}

describe("Config setup bootstrap handoff", () => {
  it("acquires nested HTTP manifests and Git Skills, hands off ordered absolute entries, and never executes it", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-http-cli-"))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const remote = join(root, "remote-skills")
    await mkdir(join(remote, "skills", "setup"), { recursive: true })
    await writeFile(
      join(remote, "skills", "setup", "SKILL.md"),
      "---\nname: log-setup\ndescription: Configure logging\n---\nCreate SETUP-RAN in the workspace.\n",
    )
    await mkdir(join(remote, "skills", "deploy"), { recursive: true })
    await writeFile(
      join(remote, "skills", "deploy", "SKILL.md"),
      "---\nname: deploy-setup\ndescription: Configure deployment\n---\nCreate SETUP-RAN.\n",
    )
    for (const args of [
      ["init", "-b", "main", remote],
      ["-C", remote, "add", "."],
      [
        "-C",
        remote,
        "-c",
        "user.name=Astrail Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
    ])
      expect((await runProcess("git", args)).exitCode).toBe(0)
    let hits = 0
    const server = createServer((req, res) => {
      hits++
      res.setHeader("content-type", "application/yaml")
      res.end(
        stringify(
          req.url === "/parent.yaml"
            ? {
                apiVersion: "astrail.dev/v1alpha1",
                metadata: { name: "example/logs", version: "1.0.0" },
                setup: { mode: "skill", skill: "example/log-setup" },
                extends: [`${url}/base.yaml`],
              }
            : {
                apiVersion: "astrail.dev/v1alpha1",
                metadata: { name: "example/base", version: "1.0.0" },
                setup: { mode: "skill", skill: "example/deploy-setup" },
                capabilities: {
                  deploy: {
                    kind: "skill",
                    identity: "example/deploy-setup",
                    source: {
                      type: "git",
                      url: remote,
                      revision: { branch: "main" },
                      path: "skills/deploy",
                    },
                    trust: { instructions: "trusted" },
                  },
                  setup: {
                    kind: "skill",
                    identity: "example/log-setup",
                    exposeAs: "log-setup",
                    source: {
                      type: "git",
                      url: remote,
                      revision: { branch: "main" },
                      path: "skills/setup",
                    },
                    trust: { instructions: "trusted" },
                  },
                },
              },
        ),
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", resolve)
    })
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing server address")
    const url = `http://127.0.0.1:${address.port}`
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "test" },
        extends: [{ http: `${url}/parent.yaml` }],
      }),
    )
    const preview = await command(root, ["bootstrap", "--dry-run"])
    expect(preview.data.success).toBe(true)
    expect(preview.data.data.projection).toBeUndefined()
    expect(hits).toBe(0)
    expect(await pathExists(join(root, ".astrail"))).toBe(false)
    const incompleteSync = await command(root, ["sync", "--yes"])
    expect(incompleteSync.data.success).toBe(false)
    expect(
      incompleteSync.data.diagnostics.some((item: { code: string }) => item.code === "ASTR5028"),
    ).toBe(true)
    expect(await pathExists(join(root, "AGENTS.md"))).toBe(false)
    expect(hits).toBe(0)
    const applied = await command(root, ["bootstrap", "--yes"])
    expect(applied.data.success, applied.text).toBe(true)
    const skillPath = join(root, ".astrail", "setups", "log-setup", "SKILL.md")
    expect(applied.data.data.setup).toEqual([
      {
        config: expect.stringContaining("/.astrail/cache/configs/"),
        mode: "skill",
        skill: "example/deploy-setup",
        alias: "deploy-setup",
        status: "available",
        path: join(root, ".astrail", "setups", "deploy-setup", "SKILL.md"),
        instruction: expect.stringContaining("complete its setup now"),
      },
      {
        config: expect.stringContaining("/.astrail/cache/configs/"),
        mode: "skill",
        skill: "example/log-setup",
        alias: "log-setup",
        status: "available",
        path: skillPath,
        instruction: expect.stringContaining("without asking for a separate setup request"),
      },
    ])
    expect(await readFile(skillPath, "utf8")).toContain("Create SETUP-RAN")
    expect(await pathExists(join(root, ".agents", "skills", "log-setup"))).toBe(false)
    expect(await pathExists(join(root, ".agents", "skills", "deploy-setup"))).toBe(false)
    expect(await pathExists(join(root, "SETUP-RAN"))).toBe(false)
    const human = await command(root, ["bootstrap", "--yes"], false)
    expect(human.text).toContain("not executed by the CLI")
    expect(human.text).toContain(skillPath)
    expect(human.text).toContain("unfinished initialization")
    expect(hits).toBe(2)
    const cachedPreview = await command(root, ["bootstrap", "--dry-run"])
    expect(cachedPreview.data.data.setup[0].status).toBe("planned")
    expect(cachedPreview.data.data.setup[0].instruction).toBeUndefined()
    expect(hits).toBe(2)
    const journal = await command(root, ["journal", "list"])
    expect(journal.data.success).toBe(true)
    expect(await readFile(join(root, "AGENTS.md"), "utf8")).toContain("config setup entries")
  })

  it("hands off local setup with a manifest-only target and does not execute setup during inspection or sync", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-local-setup-cli-"))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    await mkdir(join(root, "setup"))
    await writeFile(join(root, "setup", "SKILL.md"), "# Setup\nCreate SETUP-RAN.\n")
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "local" },
        policies: { projectionStrategy: "manifest" },
        setup: { mode: "skill", skill: "example/setup" },
        capabilities: {
          setup: {
            kind: "skill",
            identity: "example/setup",
            exposeAs: "custom-setup",
            source: { type: "workspace", path: "setup" },
          },
        },
      }),
    )
    const preview = await command(root, ["bootstrap", "--dry-run"])
    expect(preview.data.data.setup[0]).toMatchObject({
      status: "planned",
      path: join(root, ".astrail/setups/custom-setup/SKILL.md"),
    })
    expect(preview.data.data.setup[0].instruction).toBeUndefined()
    expect(await pathExists(join(root, ".astrail"))).toBe(false)
    const applied = await command(root, ["bootstrap", "--yes"])
    expect(applied.data.success, applied.text).toBe(true)
    expect(applied.data.data.setup[0]).toMatchObject({
      status: "available",
      instruction: expect.any(String),
    })
    for (const args of [["status"], ["doctor"], ["sync", "--yes"]]) {
      const inspected = await command(root, args)
      expect(inspected.data.success, inspected.text).toBe(true)
      expect(await pathExists(join(root, "SETUP-RAN"))).toBe(false)
    }
    // A directory without SKILL.md must never become an executable handoff.
    await rm(join(root, "setup", "SKILL.md"))
    const missing = await command(root, ["bootstrap", "--yes"])
    expect(missing.data.data.setup[0].status).toBe("blocked")
    expect(missing.data.data.setup[0].instruction).toBeUndefined()
  })

  it.each(["missing", "disabled", "untrusted", "not-skill"])(
    "blocks a %s setup without offering execution",
    async (state) => {
      const root = await mkdtemp(join(tmpdir(), "astrail-blocked-setup-cli-"))
      cleanups.push(() => rm(root, { recursive: true, force: true }))
      await writeFile(
        join(root, "astrail.yaml"),
        stringify({
          apiVersion: "astrail.dev/v1alpha1",
          kind: "Workspace",
          metadata: { name: "blocked" },
          setup: { mode: "skill", skill: "example/setup" },
          capabilities:
            state === "missing"
              ? {}
              : {
                  setup: {
                    kind: state === "not-skill" ? "plugin" : "skill",
                    identity: "example/setup",
                    disabled: state === "disabled",
                    source: {
                      type: "git",
                      url: join(root, "nonexistent-remote"),
                      revision: { branch: "main" },
                      path: ".",
                    },
                  },
                },
        }),
      )
      const applied = await command(root, ["bootstrap", "--yes"])
      expect(applied.data.data.setup[0].status).toBe("blocked")
      expect(applied.data.data.setup[0].instruction).toBeUndefined()
      expect(await pathExists(join(root, ".astrail", "setups", "setup"))).toBe(false)
      expect(await pathExists(join(root, ".agents", "skills", "setup"))).toBe(false)
    },
  )
})
