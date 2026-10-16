import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { inspectRepository } from "./git.js"
import { runProcess } from "./process.js"

describe("Git repository inspection", () => {
  it("supports ordinary clones and worktrees without assuming .git is a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-git-"))
    const repository = join(root, "repository")
    const worktree = join(root, "worktree")
    expect((await runProcess("git", ["init", repository])).exitCode).toBe(0)
    await writeFile(join(repository, "README.md"), "fixture")
    expect((await runProcess("git", ["-C", repository, "add", "README.md"])).exitCode).toBe(0)
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
    expect(
      (
        await runProcess("git", [
          "-C",
          repository,
          "worktree",
          "add",
          "-b",
          "fixture-worktree",
          worktree,
        ])
      ).exitCode,
    ).toBe(0)

    expect(await inspectRepository(repository)).toMatchObject({
      present: true,
      isGitRepository: true,
      gitDirKind: "directory",
    })
    expect(await inspectRepository(worktree)).toMatchObject({
      present: true,
      isGitRepository: true,
      gitDirKind: "file",
      branch: "fixture-worktree",
    })
  })
})
