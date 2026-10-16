import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathExists, resolveWorkspace, runProcess } from "astrail-core"
import { afterEach, describe, expect, it } from "vitest"
import {
  doctorCodexProjection,
  gitCapabilityResolutions,
  planCodexProjection,
  syncCodexProjection,
} from "./index.js"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function fixture(strategy: "link" | "copy" | "manifest" = "link") {
  const root = await mkdtemp(join(tmpdir(), "astrail-internal-setup-"))
  roots.push(root)
  await mkdir(join(root, "configs", "setup", "references"), { recursive: true })
  await writeFile(
    join(root, "configs", "setup", "SKILL.md"),
    "# Setup\nRead references/config.md.\n",
  )
  await writeFile(
    join(root, "configs", "setup", "references", "config.md"),
    "Configure the project.\n",
  )
  await writeFile(
    join(root, "configs", "logs.yaml"),
    `
setup: { mode: skill, skill: example/setup }
capabilities:
  setup:
    kind: skill
    identity: example/setup
    source: { type: config, path: setup }
  logs:
    kind: skill
    identity: example/logs
    source: { type: config, path: setup }
`,
  )
  await writeFile(
    join(root, "astrail.yaml"),
    `
apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata: { name: internal-setup }
extends: [./configs/logs.yaml]
policies: { projectionStrategy: ${strategy} }
capabilities:
  setup: { exposeAs: project-setup }
`,
  )
  return {
    root,
    hidden: join(root, ".astrail", "setups", "project-setup"),
    daily: join(root, ".agents", "skills", "project-setup"),
  }
}

async function legacyProjection(root: string) {
  const workspace = await resolveWorkspace({ cwd: root })
  // Simulate the old target, which projected setup like any other active Skill.
  workspace.configSetups = []
  const initial = await syncCodexProjection(await planCodexProjection(workspace), {
    authorized: true,
  })
  expect(initial.success, JSON.stringify(initial.diagnostics)).toBe(true)
  return initial.data
}

describe("Internal config setup resources", () => {
  it.each(["link", "copy", "manifest"] as const)(
    "prepares complete setup resources outside daily Skills with %s projection",
    async (strategy) => {
      const f = await fixture(strategy)
      const workspace = await resolveWorkspace({ cwd: f.root })
      const plan = await planCodexProjection(workspace)
      expect(plan.artifacts.find((item) => item.identity === "example/setup")).toMatchObject({
        path: ".astrail/setups/project-setup",
        ownership: "derived-copy",
      })
      expect(plan.artifacts.find((item) => item.identity === "example/logs")?.path).toBe(
        ".agents/skills/logs",
      )
      expect((await syncCodexProjection(plan, { dryRun: true })).success).toBe(true)
      expect(await pathExists(join(f.root, ".astrail"))).toBe(false)
      expect((await syncCodexProjection(plan)).success).toBe(true)
      expect(await readFile(join(f.hidden, "references", "config.md"), "utf8")).toBe(
        "Configure the project.\n",
      )
      expect(await pathExists(f.daily)).toBe(false)
      expect(await pathExists(join(f.root, ".agents", "skills", "logs"))).toBe(
        strategy !== "manifest",
      )
      expect((await planCodexProjection(workspace)).changePlan.actions).toEqual([])
      expect((await doctorCodexProjection(workspace)).data.current).toBe(true)

      await rm(f.hidden, { recursive: true })
      expect((await doctorCodexProjection(workspace)).data.current).toBe(false)
      expect((await syncCodexProjection(await planCodexProjection(workspace))).success).toBe(true)
      await writeFile(join(f.hidden, "SKILL.md"), "Changed copy\n")
      expect(
        (await doctorCodexProjection(workspace)).diagnostics.some((d) => d.code === "ASTR5025"),
      ).toBe(true)
      expect((await syncCodexProjection(await planCodexProjection(workspace))).success).toBe(true)
      expect(await readFile(join(f.hidden, "SKILL.md"), "utf8")).toContain(
        "Read references/config.md",
      )
    },
  )

  it.each(["link", "copy", "manifest"] as const)(
    "migrates an owned legacy %s setup and preserves its source",
    async (strategy) => {
      const f = await fixture(strategy)
      await legacyProjection(f.root)
      const workspace = await resolveWorkspace({ cwd: f.root })
      const plan = await planCodexProjection(workspace)
      expect(plan.changePlan.actions).toContainEqual(
        expect.objectContaining({ type: "remove", target: f.daily }),
      )
      await syncCodexProjection(plan, { dryRun: true })
      expect(await pathExists(f.hidden)).toBe(false)
      expect(await pathExists(f.daily)).toBe(strategy !== "manifest")
      expect((await syncCodexProjection(plan)).success).toBe(true)
      expect(await pathExists(f.daily)).toBe(false)
      expect(await readFile(join(f.hidden, "SKILL.md"), "utf8")).toContain("# Setup")
      expect(await pathExists(join(f.root, "configs", "setup", "SKILL.md"))).toBe(true)
      expect((await doctorCodexProjection(workspace)).data.current).toBe(true)
    },
  )

  it("moves a verified Git setup locally while preserving its resolved commit and integrity", async () => {
    const f = await fixture()
    const remote = join(f.root, "remote")
    await mkdir(remote)
    await writeFile(join(remote, "SKILL.md"), "# Remote setup\n")
    for (const args of [
      ["init", "-b", "main", remote],
      ["-C", remote, "add", "."],
      [
        "-C",
        remote,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
    ])
      expect((await runProcess("git", args)).exitCode).toBe(0)
    await writeFile(
      join(f.root, "configs", "logs.yaml"),
      `
setup: { mode: skill, skill: example/setup }
capabilities:
  setup:
    kind: skill
    identity: example/setup
    source: { type: git, url: ${remote}, revision: { branch: main }, path: . }
    trust: { instructions: trusted }
`,
    )
    const legacy = await legacyProjection(f.root)
    const resolutions = gitCapabilityResolutions(legacy)
    const configPath = join(f.root, "configs", "logs.yaml")
    const config = await readFile(configPath, "utf8")
    await writeFile(
      configPath,
      `${config}
  unavailable:
    kind: skill
    identity: example/unavailable
    source: { type: git, url: ${join(f.root, "missing-remote")}, revision: { branch: main }, path: . }
    trust: { instructions: trusted }
`,
    )
    const failed = await syncCodexProjection(
      await planCodexProjection(await resolveWorkspace({ cwd: f.root })),
      { authorized: true },
    )
    expect(failed.success).toBe(false)
    expect(failed.diagnostics.some((d) => d.code === "ASTR5013")).toBe(true)
    expect(await pathExists(f.hidden)).toBe(false)
    expect(await pathExists(f.daily)).toBe(true)
    await writeFile(configPath, config)
    await rm(remote, { recursive: true })
    const workspace = await resolveWorkspace({ cwd: f.root })
    const plan = await planCodexProjection(workspace)
    expect(plan.changes.some((change) => change.kind === "relocate")).toBe(true)
    expect(plan.changePlan.actions.some((action) => action.requiresAuthorization)).toBe(false)
    expect((await syncCodexProjection(plan)).success).toBe(true)
    expect(gitCapabilityResolutions(plan)).toEqual(resolutions)
    expect(await readFile(join(f.hidden, "SKILL.md"), "utf8")).toBe("# Remote setup\n")
    expect(await pathExists(f.daily)).toBe(false)
    expect((await planCodexProjection(workspace)).changePlan.actions).toEqual([])
  })

  it.each(["before-plan", "after-plan"])(
    "preserves modified legacy copies changed %s",
    async (timing) => {
      const f = await fixture("copy")
      await legacyProjection(f.root)
      const workspace = await resolveWorkspace({ cwd: f.root })
      const earlyPlan = await planCodexProjection(workspace)
      await writeFile(join(f.daily, "SKILL.md"), "My local setup edits\n")
      const plan = timing === "after-plan" ? earlyPlan : await planCodexProjection(workspace)
      const result = await syncCodexProjection(plan)
      expect(result.success).toBe(false)
      expect(result.diagnostics.some((d) => d.code === "ASTR5029")).toBe(true)
      expect(await readFile(join(f.daily, "SKILL.md"), "utf8")).toBe("My local setup edits\n")
      expect(await pathExists(f.hidden)).toBe(false)
    },
  )

  it("preserves a replaced legacy link and an unowned internal destination", async () => {
    const f = await fixture()
    await legacyProjection(f.root)
    await rm(f.daily)
    await symlink(join(f.root, "configs"), f.daily)
    const workspace = await resolveWorkspace({ cwd: f.root })
    expect((await syncCodexProjection(await planCodexProjection(workspace))).success).toBe(false)
    await rm(f.daily)
    await symlink(join(f.root, "configs", "setup"), f.daily)
    await mkdir(f.hidden, { recursive: true })
    await writeFile(join(f.hidden, "SKILL.md"), "User owned\n")
    const refused = await syncCodexProjection(await planCodexProjection(workspace))
    expect(refused.success).toBe(false)
    expect(refused.diagnostics.some((d) => d.code === "ASTR5010")).toBe(true)
    expect(await readFile(join(f.hidden, "SKILL.md"), "utf8")).toBe("User owned\n")
    expect(await pathExists(f.daily)).toBe(true)
  })

  it("reports an unowned daily setup instead of deleting it or silently leaving it exposed", async () => {
    const f = await fixture()
    await mkdir(f.daily, { recursive: true })
    await writeFile(join(f.daily, "SKILL.md"), "User setup\n")
    const plan = await planCodexProjection(await resolveWorkspace({ cwd: f.root }))
    expect(plan.diagnostics.some((d) => d.code === "ASTR5010")).toBe(true)
    expect((await syncCodexProjection(plan)).success).toBe(false)
    expect(await readFile(join(f.daily, "SKILL.md"), "utf8")).toBe("User setup\n")
    expect(await pathExists(f.hidden)).toBe(false)
  })

  it.each(["", "setup: { mode: none }\n"])(
    "keeps dependency setups when a parent declares %j",
    async (setup) => {
      const f = await fixture()
      await writeFile(join(f.root, "configs", "parent.yaml"), `extends: [./logs.yaml]\n${setup}`)
      const manifest = await readFile(join(f.root, "astrail.yaml"), "utf8")
      await writeFile(
        join(f.root, "astrail.yaml"),
        manifest.replace("./configs/logs.yaml", "./configs/parent.yaml"),
      )
      const workspace = await resolveWorkspace({ cwd: f.root })
      expect(workspace.configSetups).toHaveLength(1)
      expect((await syncCodexProjection(await planCodexProjection(workspace))).success).toBe(true)
      expect(await pathExists(f.hidden)).toBe(true)
      expect(await pathExists(f.daily)).toBe(false)
      // Removing that file's own declaration leaves its capability as an ordinary Skill.
      const config = await readFile(join(f.root, "configs", "logs.yaml"), "utf8")
      await writeFile(
        join(f.root, "configs", "logs.yaml"),
        config.replace("setup: { mode: skill, skill: example/setup }", setup),
      )
      const noSetup = await resolveWorkspace({ cwd: f.root })
      expect(noSetup.configSetups).toEqual([])
      expect((await syncCodexProjection(await planCodexProjection(noSetup))).success).toBe(true)
      expect(await pathExists(f.hidden)).toBe(false)
      expect(await pathExists(f.daily)).toBe(true)
    },
  )
})
