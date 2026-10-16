import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { stageGitCapability } from "./capability-acquisition.js"
import { pathExists } from "./fs.js"
import { runProcess } from "./process.js"
import type { ResolvedCapability } from "./types.js"

describe("Git capability acquisition", () => {
  it("stages a selected Skill, records its commit, and cleans up explicitly", async () => {
    const fixture = await gitSkillFixture()
    const temporaryRoot = join(fixture.root, "staging")
    const staged = await stageGitCapability(gitCapability(fixture.repository), { temporaryRoot })

    expect(await pathExists(join(staged.path, "SKILL.md"))).toBe(true)
    expect(staged.resolvedCommit).toBe(fixture.commit)
    expect(staged.integrity).toMatch(/^sha256-/)
    expect(staged.path).toContain("astrail-capability-")

    await staged.cleanup()
    expect(await pathExists(staged.stagingRoot)).toBe(false)
    await staged.cleanup()
  })

  it("removes staging when Skill validation fails", async () => {
    const fixture = await gitSkillFixture(false)
    const temporaryRoot = join(fixture.root, "staging")

    await expect(
      stageGitCapability(gitCapability(fixture.repository), { temporaryRoot }),
    ).rejects.toThrow("does not contain SKILL.md")
    expect(await readdir(temporaryRoot)).toEqual([])
  })

  it("rejects escaping content paths before projection", async () => {
    const fixture = await gitSkillFixture()
    const capability = gitCapability(fixture.repository)
    if (capability.source.type !== "git") throw new Error("Expected Git fixture")
    capability.source.path = "../outside"
    const temporaryRoot = join(fixture.root, "staging")

    await expect(stageGitCapability(capability, { temporaryRoot })).rejects.toThrow(
      "escapes its checkout",
    )
    expect(await readdir(temporaryRoot)).toEqual([])
  })
})

async function gitSkillFixture(withSkill = true): Promise<{
  root: string
  repository: string
  commit: string
}> {
  const root = await mkdtemp(join(tmpdir(), "astrail-capability-source-"))
  const repository = join(root, "repository")
  await mkdir(join(repository, "skills", "loghelper"), { recursive: true })
  await writeFile(
    join(repository, "skills", "loghelper", withSkill ? "SKILL.md" : "README.md"),
    "# loghelper\n",
  )
  expect((await runProcess("git", ["init", repository])).exitCode).toBe(0)
  expect((await runProcess("git", ["-C", repository, "add", "."])).exitCode).toBe(0)
  expect(
    (
      await runProcess("git", [
        "-C",
        repository,
        "-c",
        "user.name=Astrail Test",
        "-c",
        "user.email=astrail@example.invalid",
        "commit",
        "-m",
        "fixture",
      ])
    ).exitCode,
  ).toBe(0)
  const revision = await runProcess("git", ["-C", repository, "rev-parse", "HEAD"])
  return { root, repository, commit: revision.stdout.trim() }
}

function gitCapability(repository: string): ResolvedCapability {
  return {
    id: "loghelper",
    identity: "example/loghelper",
    version: "1.0.0",
    kind: "skill",
    exposeAs: "loghelper",
    source: {
      type: "git",
      url: repository,
      revision: { branch: "master" },
      path: "skills/loghelper",
    },
    active: true,
  }
}
