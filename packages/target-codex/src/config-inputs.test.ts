import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathExists, resolveWorkspace } from "astrail-core"
import { createProjectionTarget } from "astrail-target-shared"
import { afterEach, describe, expect, it } from "vitest"

const stringify = (value: unknown) => JSON.stringify(value, null, 2)

import { planCodexProjection, syncCodexProjection } from "./index.js"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(strategy = "link") {
  const root = await mkdtemp(join(tmpdir(), "astrail-input-projection-"))
  roots.push(root)
  await writeFile(
    join(root, "astrail.yaml"),
    stringify({
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "test" },
      extends: [{ local: "./config.yaml", with: { repository: "journal" } }],
      policies: { projectionStrategy: strategy },
    }),
  )
  await writeFile(
    join(root, "config.yaml"),
    stringify({
      inputs: {
        type: "object",
        additionalProperties: false,
        properties: { repository: { type: "string" } },
      },
    }),
  )
  const workspace = await resolveWorkspace({ cwd: root })
  const inputPath = join(root, ".astrail/config-inputs", `${workspace.configs[0]?.key}.json`)
  return { root, workspace, inputPath }
}
describe("config input projection", () => {
  it.each(["link", "copy", "manifest"])(
    "writes and updates inputs independently of %s skills, then removes only owned files",
    async (strategy) => {
      const f = await fixture(strategy)
      const plan = await planCodexProjection(f.workspace)
      expect((await syncCodexProjection(plan, { dryRun: true })).success).toBe(true)
      expect(await pathExists(f.inputPath)).toBe(false)
      expect((await syncCodexProjection(plan)).success).toBe(true)
      expect(JSON.parse(await readFile(f.inputPath, "utf8")).inputs.repository).toBe("journal")
      expect((await planCodexProjection(await resolveWorkspace({ cwd: f.root }))).changes).toEqual(
        [],
      )
      await writeFile(
        join(f.root, "astrail.yaml"),
        (await readFile(join(f.root, "astrail.yaml"), "utf8")).replace(
          '"repository": "journal"',
          '"repository": "updated"',
        ),
      )
      expect(
        (
          await syncCodexProjection(
            await planCodexProjection(await resolveWorkspace({ cwd: f.root })),
          )
        ).success,
      ).toBe(true)
      expect(JSON.parse(await readFile(f.inputPath, "utf8")).inputs.repository).toBe("updated")
      await writeFile(
        join(f.root, "astrail.yaml"),
        "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: test }\n",
      )
      expect(
        (
          await syncCodexProjection(
            await planCodexProjection(await resolveWorkspace({ cwd: f.root })),
          )
        ).success,
      ).toBe(true)
      expect(await pathExists(f.inputPath)).toBe(false)
      expect(await pathExists(join(f.root, "config.yaml"))).toBe(true)
    },
  )
  it("rejects stale input plans before writing files", async () => {
    const f = await fixture()
    const plan = await planCodexProjection(f.workspace)
    await writeFile(
      join(f.root, "astrail.yaml"),
      (await readFile(join(f.root, "astrail.yaml"), "utf8")).replace(
        '"repository": "journal"',
        '"repository": "updated"',
      ),
    )
    expect(
      (await syncCodexProjection(plan)).diagnostics.some((item) => item.code === "ASTR5034"),
    ).toBe(true)
    expect(await pathExists(f.inputPath)).toBe(false)
  })
  it("preserves unowned, edited and symlinked input destinations", async () => {
    const f = await fixture()
    await mkdir(join(f.root, ".astrail/config-inputs"), { recursive: true })
    await writeFile(f.inputPath, "user data")
    expect(
      (await planCodexProjection(f.workspace)).diagnostics.some((item) => item.code === "ASTR5033"),
    ).toBe(true)
    await rm(f.inputPath)
    expect((await syncCodexProjection(await planCodexProjection(f.workspace))).success).toBe(true)
    await writeFile(f.inputPath, "edited")
    expect((await syncCodexProjection(await planCodexProjection(f.workspace))).success).toBe(false)
    expect(await readFile(f.inputPath, "utf8")).toBe("edited")
    await rm(f.inputPath)
    await symlink(join(f.root, "config.yaml"), f.inputPath)
    expect(
      (await planCodexProjection(f.workspace)).diagnostics.some((item) => item.code === "ASTR5033"),
    ).toBe(true)
  })
  it("shares input artifacts with CodeBuddy and supports sequential updates", async () => {
    const f = await fixture()
    const buddy = createProjectionTarget({
      id: "codebuddy",
      skillsDirectory: ".codebuddy/skills",
      instructionsPath: ".codebuddy/rules/astrail/RULE.mdc",
      manifestPath: ".astrail/projections/codebuddy.json",
    })
    expect((await syncCodexProjection(await planCodexProjection(f.workspace))).success).toBe(true)
    expect((await buddy.syncProjection(await buddy.planProjection(f.workspace))).success).toBe(true)
    await writeFile(
      join(f.root, "astrail.yaml"),
      (await readFile(join(f.root, "astrail.yaml"), "utf8")).replace(
        '"repository": "journal"',
        '"repository": "updated"',
      ),
    )
    const next = await resolveWorkspace({ cwd: f.root })
    expect((await syncCodexProjection(await planCodexProjection(next))).success).toBe(true)
    expect((await buddy.syncProjection(await buddy.planProjection(next))).success).toBe(true)
    expect((await buddy.planProjection(next)).changes).toEqual([])
  })
})
