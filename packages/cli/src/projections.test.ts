import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathExists, resolveWorkspace, runProcess, stageGitCapability } from "astrail-core"
import { afterEach, describe, expect, it } from "vitest"
import { parse, stringify } from "yaml"
import { createProgram } from "./program.js"
import { planWorkspaceProjections, syncWorkspaceProjections } from "./projections.js"

const roots: string[] = []
const exitCode = process.exitCode
afterEach(async () => {
  process.exitCode = exitCode
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "astrail-targets-"))
  roots.push(root)
  return root
}
async function manifest(root: string, fields: Record<string, unknown> = {}) {
  await writeFile(
    join(root, "astrail.yaml"),
    stringify({
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "targets" },
      ...fields,
    }),
  )
}
async function cli(root: string, ...args: string[]) {
  const output: string[] = []
  await createProgram({ out: (value) => output.push(value), err: () => {} }).parseAsync(
    ["--json", "--cwd", root, ...args],
    { from: "user" },
  )
  return JSON.parse(output.join(""))
}
async function succeeds(root: string, ...args: string[]) {
  const value = await cli(root, ...args)
  expect(value.success, JSON.stringify(value.diagnostics)).toBe(true)
  return value
}
const both = { codebuddy: { type: "codebuddy" } }
const buddyOnly = { codex: { disabled: true }, codebuddy: { type: "codebuddy", primary: true } }
const text = (root: string, path: string) => readFile(join(root, path), "utf8")
async function git(root: string, ...args: string[]) {
  const value = await runProcess("git", ["-C", root, ...args])
  expect(value.exitCode, value.stderr).toBe(0)
  return value.stdout.trim()
}

describe("workspace target orchestration", () => {
  it.each(["link", "copy", "manifest"])(
    "supports CodeBuddy-only %s projection without touching native instructions",
    async (strategy) => {
      const root = await directory()
      await manifest(root, { targets: buddyOnly, policies: { projectionStrategy: strategy } })
      await writeFile(join(root, "CODEBUDDY.md"), "Personal instructions\n")
      const preview = await succeeds(root, "install", "--dry-run")
      expect(Object.keys(preview.data.projection.targets)).toEqual(["codebuddy"])
      expect(await pathExists(join(root, ".codebuddy"))).toBe(false)
      await succeeds(root, "install", "--yes")
      expect(await text(root, "CODEBUDDY.md")).toBe("Personal instructions\n")
      expect(await pathExists(join(root, "AGENTS.md"))).toBe(false)
      const rule = await text(root, ".codebuddy/rules/astrail/RULE.mdc")
      expect(rule).toContain("alwaysApply: true")
      expect(rule).toContain("astrail:begin codebuddy")
      expect(rule).not.toContain("$astrail-")
      expect(await pathExists(join(root, ".codebuddy/skills/astrail-editor/SKILL.md"))).toBe(
        strategy !== "manifest",
      )
      const repeat = await succeeds(root, "install", "--dry-run")
      expect(repeat.data.projection.changePlan.actions).toEqual([])
      const status = await succeeds(root, "status")
      expect(status.data.projections.codebuddy.current).toBe(true)
      expect(status.data.projections.codex).toBeUndefined()
      expect((await succeeds(root, "doctor")).data.projections.codebuddy.current).toBe(true)
    },
  )

  it("installs both targets, preserves legacy Codex ownership, and disables without deleting outputs", async () => {
    const root = await directory()
    await manifest(root)
    await succeeds(root, "install", "--yes")
    const agents = await text(root, "AGENTS.md")
    const legacy = await text(root, ".astrail/projection-manifest.json")
    await manifest(root, { targets: both })
    await succeeds(root, "install", "--yes")
    expect(await text(root, "AGENTS.md")).toBe(agents)
    expect(await text(root, ".astrail/projection-manifest.json")).toBe(legacy)
    expect(Object.keys((await succeeds(root, "status")).data.projections).sort()).toEqual([
      "codebuddy",
      "codex",
    ])
    const buddy = await text(root, ".astrail/projections/codebuddy.json")
    await manifest(root, { targets: { codebuddy: { type: "codebuddy", disabled: true } } })
    await succeeds(root, "install", "--yes")
    expect(await text(root, ".astrail/projections/codebuddy.json")).toBe(buddy)
    expect((await succeeds(root, "status")).data.projections.codebuddy).toBeUndefined()
  })

  it("rolls back both targets when the second target encounters a user-owned Skill", async () => {
    const root = await directory()
    await manifest(root, { targets: both })
    await mkdir(join(root, ".agents/skills/astrail-editor"), { recursive: true })
    await writeFile(join(root, ".agents/skills/astrail-editor/SKILL.md"), "User-owned\n")
    const result = await cli(root, "install", "--yes")
    expect(result.success).toBe(false)
    expect(result.data.rolledBack).toBe(true)
    expect(await text(root, ".agents/skills/astrail-editor/SKILL.md")).toBe("User-owned\n")
    expect(await pathExists(join(root, ".codebuddy/rules/astrail/RULE.mdc"))).toBe(false)
    expect(await pathExists(join(root, ".astrail/projections/codebuddy.json"))).toBe(false)
    expect(await pathExists(join(root, "astrail.lock.yaml"))).toBe(false)
  })

  it("refuses a user-owned rule, unsafe parent, and changed instructions after preview", async () => {
    const root = await directory()
    await manifest(root, { targets: buddyOnly })
    const rules = join(root, ".codebuddy/rules/astrail")
    await mkdir(rules, { recursive: true })
    await writeFile(join(rules, "RULE.mdc"), "Personal rule\n")
    expect((await cli(root, "install", "--yes")).success).toBe(false)
    expect(await text(root, ".codebuddy/rules/astrail/RULE.mdc")).toBe("Personal rule\n")
    await rm(join(root, ".codebuddy"), { recursive: true })
    const outside = await directory()
    await symlink(outside, join(root, ".codebuddy"))
    expect((await cli(root, "install", "--yes")).success).toBe(false)
    expect(await pathExists(join(outside, "rules"))).toBe(false)
    await rm(join(root, ".codebuddy"))
    await succeeds(root, "install", "--yes")
    const workspace = await resolveWorkspace({ cwd: root })
    // Force a Skill action so the synchronization checks its recorded instruction read.
    await rm(join(root, ".codebuddy/skills/astrail-editor"))
    const plan = await planWorkspaceProjections(workspace)
    await writeFile(
      join(rules, "RULE.mdc"),
      `${await text(root, ".codebuddy/rules/astrail/RULE.mdc")}Personal addition\n`,
    )
    const result = await syncWorkspaceProjections(plan)
    expect(result.success).toBe(false)
    expect(result.diagnostics.some((d) => d.code === "ASTR5032")).toBe(true)
  })

  it("shares Git acquisition across targets, locks one resolution, and updates both copies", async () => {
    const root = await directory()
    const remote = await directory()
    await git(remote, "init", "-b", "main")
    await mkdir(join(remote, "example"))
    await writeFile(join(remote, "example/SKILL.md"), "# First\n")
    const commit = async () => {
      await git(remote, "add", ".")
      await git(
        remote,
        "-c",
        "user.name=Target Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "fixture",
      )
      return git(remote, "rev-parse", "HEAD")
    }
    const first = await commit()
    await manifest(root, {
      targets: both,
      capabilities: {
        example: {
          kind: "skill",
          identity: "team/example",
          trust: { instructions: "trusted" },
          source: {
            type: "git",
            url: `file://${remote}`,
            revision: { branch: "main" },
            path: "example",
          },
        },
      },
    })
    let acquisitions = 0
    const projected = await syncWorkspaceProjections(
      await planWorkspaceProjections(await resolveWorkspace({ cwd: root })),
      {
        authorized: true,
        acquire: async (capability, options) => {
          acquisitions += 1
          return stageGitCapability(capability, options)
        },
      },
    )
    expect(projected.success, JSON.stringify(projected.diagnostics)).toBe(true)
    expect(acquisitions).toBe(1)
    await succeeds(root, "install", "--yes")
    for (const path of [".agents/skills/example", ".codebuddy/skills/example"])
      expect(await text(root, `${path}/SKILL.md`)).toBe("# First\n")
    const firstLock = parse(await text(root, "astrail.lock.yaml"))
    expect(JSON.stringify(firstLock)).toContain(first)
    expect(
      (await succeeds(root, "install", "--dry-run")).data.projection.changePlan.actions,
    ).toEqual([])
    await writeFile(join(remote, "example/SKILL.md"), "# Second\n")
    const second = await commit()
    // A legacy synced workspace may have a healthy Codex copy but no lock yet.
    await rm(join(root, "astrail.lock.yaml"))
    await rm(join(root, ".codebuddy"), { recursive: true })
    await rm(join(root, ".astrail/projections/codebuddy.json"))
    await succeeds(root, "install", "--yes")
    expect(await text(root, ".codebuddy/skills/example/SKILL.md")).toBe("# First\n")
    expect((await succeeds(root, "status")).data.projections.codebuddy.current).toBe(true)
    await succeeds(root, "update", "--yes")
    for (const path of [".agents/skills/example", ".codebuddy/skills/example"])
      expect(await text(root, `${path}/SKILL.md`)).toBe("# Second\n")
    expect(JSON.stringify(parse(await text(root, "astrail.lock.yaml")))).toContain(second)
    expect((await succeeds(root, "status")).data.projections.codex.current).toBe(true)
    expect((await succeeds(root, "status")).data.projections.codebuddy.current).toBe(true)
  })

  it("shares setup outside daily Skills and transfers its ownership when Codex is disabled", async () => {
    const root = await directory()
    await mkdir(join(root, "setup"))
    await writeFile(join(root, "setup/SKILL.md"), "# Setup\n")
    const setupFields = {
      setup: { mode: "skill", skill: "team/setup" },
      capabilities: {
        setup: {
          kind: "skill",
          identity: "team/setup",
          source: { type: "workspace", path: "setup" },
        },
      },
    }
    await manifest(root, setupFields)
    await succeeds(root, "install", "--yes")
    await manifest(root, { ...setupFields, targets: buddyOnly })
    const installed = await succeeds(root, "install", "--yes")
    expect(installed.data.setup).toHaveLength(1)
    expect(installed.data.setup[0].status).toBe("available")
    expect(await text(root, ".astrail/setups/setup/SKILL.md")).toBe("# Setup\n")
    expect(await pathExists(join(root, ".agents/skills/setup"))).toBe(false)
    expect(await pathExists(join(root, ".codebuddy/skills/setup"))).toBe(false)
    await manifest(root, { ...setupFields, targets: both })
    await succeeds(root, "install", "--yes")
    expect(
      (await succeeds(root, "install", "--dry-run")).data.projection.changePlan.actions,
    ).toEqual([])
    await manifest(root, { targets: both })
    await succeeds(root, "install", "--yes")
    expect(await pathExists(join(root, ".astrail/setups/setup"))).toBe(false)
  })

  it("initializes CodeBuddy explicitly, and validates the inherited primary target", async () => {
    const root = await directory()
    await succeeds(root, "init", "--target", "codebuddy", "--runtime", "global", "--skip-install")
    expect(parse(await text(root, "astrail.yaml")).targets).toMatchObject(buddyOnly)
    expect((await succeeds(root, "render")).data.targets.codex).toBeUndefined()
    await manifest(root, { targets: { codebuddy: { type: "codebuddy", primary: true } } })
    const invalid = await cli(root, "install", "--dry-run")
    expect(invalid.success).toBe(false)
    expect(invalid.diagnostics.some((d: { code: string }) => d.code === "ASTR2013")).toBe(true)
  })
})
