import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveWorkspace } from "astrail-core"
import { describe, expect, it } from "vitest"
import { planCodeBuddyProjection, syncCodeBuddyProjection } from "./index.js"

describe("CodeBuddy rule ownership", () => {
  it.each([
    "---\nalwaysApply: false\n---\n",
    "---\nalwaysApply: true\nalwaysApply: false\n---\n",
    "---\ndescription: note\n---\nalwaysApply: true\n",
  ])("rejects inactive or ambiguous frontmatter without rewriting it", async (header) => {
    const root = await mkdtemp(join(tmpdir(), "astrail-codebuddy-rule-"))
    try {
      await writeFile(
        join(root, "astrail.yaml"),
        "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: {name: rule}\n",
      )
      const path = join(root, ".codebuddy/rules/astrail/RULE.mdc")
      await mkdir(join(root, ".codebuddy/rules/astrail"), { recursive: true })
      const original = `${header}<!-- astrail:begin codebuddy -->\nPrevious\n<!-- astrail:end codebuddy -->\n`
      await writeFile(path, original)
      const plan = await planCodeBuddyProjection(await resolveWorkspace({ cwd: root }))
      expect(plan.diagnostics.some((item) => item.severity === "error")).toBe(true)
      expect((await syncCodeBuddyProjection(plan)).success).toBe(false)
      expect(await readFile(path, "utf8")).toBe(original)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
