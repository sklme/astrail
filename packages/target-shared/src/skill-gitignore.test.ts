import { execFileSync } from "node:child_process"
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveWorkspace } from "astrail-core"
import { describe, expect, it } from "vitest"
import { createProjectionTarget } from "./index.js"
import { renderSkillGitignore } from "./skill-gitignore.js"

const manifest = `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata: { name: ignore-test }
capabilities:
  sample:
    kind: skill
    identity: test/sample
    exposeAs: sample
    source: { type: workspace, path: skills/sample }
`

for (const id of ["codex", "codebuddy"] as const) {
  const directory = id === "codex" ? ".agents/skills" : ".codebuddy/skills"
  const target = createProjectionTarget({
    id,
    skillsDirectory: directory,
    instructionsPath: id === "codex" ? "AGENTS.md" : ".codebuddy/rules/astrail/RULE.mdc",
    manifestPath:
      id === "codex" ? ".astrail/projection-manifest.json" : ".astrail/projections/codebuddy.json",
  })
  describe(`${id} generated Skill ignores`, () => {
    it.each(["link", "copy", "manifest"])(
      "preserves sources, user rules and the index with %s projection",
      async (strategy) => {
        const root = await mkdtemp(join(tmpdir(), "astrail-ignore-"))
        try {
          await mkdir(join(root, "skills/sample"), { recursive: true })
          await writeFile(join(root, "skills/sample/SKILL.md"), "# Source\n")
          await mkdir(join(root, directory, "handwritten"), { recursive: true })
          await writeFile(join(root, directory, "handwritten/SKILL.md"), "# User\n")
          const ignore = join(root, directory, ".gitignore")
          await writeFile(ignore, "# User rules\n/local-only\n")
          await writeFile(
            join(root, "astrail.yaml"),
            `${manifest}policies: { projectionStrategy: ${strategy} }\n`,
          )
          const git = (...args: string[]) =>
            execFileSync("git", args, { cwd: root, encoding: "utf8" })
          git("init", "-q")
          git("add", "skills", `${directory}/handwritten`)
          const indexBefore = git("ls-files", "--stage")
          const workspace = await resolveWorkspace({ cwd: root })
          const plan = await target.planProjection(workspace)
          expect((await target.syncProjection(plan, { dryRun: true })).success).toBe(true)
          expect(await readFile(ignore, "utf8")).toBe("# User rules\n/local-only\n")
          expect((await target.syncProjection(plan)).success).toBe(true)
          expect(git("ls-files", "--stage")).toBe(indexBefore)
          const rules = await readFile(ignore, "utf8")
          expect(rules.startsWith("# User rules\n/local-only\n")).toBe(true)
          if (strategy !== "manifest") {
            expect(git("check-ignore", `${directory}/sample`).trim()).toBe(`${directory}/sample`)
            expect((await lstat(join(root, directory, "sample"))).isSymbolicLink()).toBe(
              strategy === "link",
            )
          } else expect(rules).not.toContain("/sample")
          const unignored = git("ls-files", "--others", "--exclude-standard")
          expect(unignored).toContain(`${directory}/.gitignore`)
          expect(await readFile(join(root, "skills/sample/SKILL.md"), "utf8")).toBe("# Source\n")
          expect((await target.planProjection(workspace)).changes).toEqual([])
          expect((await target.doctorProjection(workspace)).data.current).toBe(true)
          // Removing a declaration also removes its ignore rule, leaving user content intact.
          await writeFile(
            join(root, "astrail.yaml"),
            `apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: {name: ignore-test}\n`,
          )
          const removed = await target.planProjection(await resolveWorkspace({ cwd: root }))
          expect((await target.syncProjection(removed)).success).toBe(true)
          expect(await readFile(ignore, "utf8")).not.toContain("/sample\n")
          expect(await readFile(join(root, directory, "handwritten/SKILL.md"), "utf8")).toBe(
            "# User\n",
          )
        } finally {
          await rm(root, { recursive: true, force: true })
        }
      },
    )

    it("rejects symlink destinations and edits after preview before writing projections", async () => {
      const root = await mkdtemp(join(tmpdir(), "astrail-ignore-race-"))
      try {
        await writeFile(
          join(root, "astrail.yaml"),
          "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: {name: ignore-test}\n",
        )
        const workspace = await resolveWorkspace({ cwd: root })
        const plan = await target.planProjection(workspace)
        await mkdir(join(root, directory), { recursive: true })
        const ignore = join(root, directory, ".gitignore")
        await writeFile(ignore, "# Concurrent user edit\n")
        expect((await target.syncProjection(plan)).success).toBe(false)
        expect(await readFile(ignore, "utf8")).toBe("# Concurrent user edit\n")
        expect(
          await lstat(join(root, directory, "astrail-editor")).catch(() => undefined),
        ).toBeUndefined()
        await rm(ignore)
        const outside = join(root, "outside")
        await writeFile(outside, "Keep\n")
        await symlink(outside, ignore)
        const unsafe = await target.planProjection(workspace)
        expect(unsafe.diagnostics.some((d) => d.code === "ASTR5035")).toBe(true)
        expect((await target.syncProjection(unsafe)).success).toBe(false)
        expect(await readFile(outside, "utf8")).toBe("Keep\n")
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })
}

it("preserves surrounding CRLF rules and rejects ambiguous managed markers", () => {
  const before =
    "# Before\r\n# astrail:begin generated-skills\r\n/old\r\n# astrail:end generated-skills\r\n!keep\r\n"
  const after = renderSkillGitignore(before, ["new"])
  expect(after).toBe(before.replace("/old", "/new"))
  expect(() => renderSkillGitignore("# astrail:begin generated-skills\n", ["new"])).toThrow()
  expect(() => renderSkillGitignore(before + before, ["new"])).toThrow()
})
