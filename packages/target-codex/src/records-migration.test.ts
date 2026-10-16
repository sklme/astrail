import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathExists, resolveWorkspace } from "astrail-core"
import { describe, expect, it } from "vitest"
import {
  doctorCodexProjection,
  planCodexProjection,
  syncCodexProjection,
  updateManagedRegion,
} from "./index.js"

const legacyIdentity = "astrail/builtin-task-records"
const legacyPath = ".agents/skills/astrail-records"
const userGuidance = "# Project guidance\nKeep records in cases/.\n"
const documents = {
  "docs/architecture.md": "# Maintained knowledge\n",
  "records/2026-10-16-release/README.md": "# Release\nStatus: released, records pending\n",
  "records/2026-10-16-release/evidence/check.json": '{"verified":true}\n',
}
const manifest = (strategy: string) =>
  `apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: records }\npolicies: { projectionStrategy: ${strategy} }\n`

async function file(root: string, path: string, content: string) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

async function legacyWorkspace(strategy: "link" | "copy" | "manifest") {
  const root = await mkdtemp(join(tmpdir(), "astrail-records-migration-"))
  await file(root, "legacy-package/skills/astrail-records/SKILL.md", "# Historical records Skill\n")
  await file(root, "AGENTS.md", userGuidance)
  for (const [path, content] of Object.entries(documents)) await file(root, path, content)
  // Recreate the historical artifact through the ordinary projector so its
  // manifest, content digest and link target match a real installed Skill.
  await file(
    root,
    "astrail.yaml",
    `${manifest(strategy)}capabilities:
  historical-records:
    kind: skill
    identity: ${legacyIdentity}
    exposeAs: astrail-records
    source: { type: workspace, path: legacy-package/skills/astrail-records }
`,
  )
  expect(
    (await syncCodexProjection(await planCodexProjection(await resolveWorkspace({ cwd: root }))))
      .success,
  ).toBe(true)
  await file(
    root,
    "AGENTS.md",
    updateManagedRegion(
      userGuidance,
      "Use $astrail-records for docs/ and records/.\nTask records and durable knowledge.",
    ),
  )
  await file(root, "astrail.yaml", manifest(strategy))
  return root
}

describe("optional records workflow migration", () => {
  it.each(["link", "copy", "manifest"] as const)(
    "retires the old %s projection while preserving documents and custom guidance",
    async (strategy) => {
      const root = await legacyWorkspace(strategy)
      try {
        const workspace = await resolveWorkspace({ cwd: root })
        const plan = await planCodexProjection(workspace)
        expect(plan.artifacts.some((artifact) => artifact.identity === legacyIdentity)).toBe(false)
        expect(plan.changes).toContainEqual(
          expect.objectContaining({ kind: "remove", path: join(root, legacyPath) }),
        )
        const before = await readFile(join(root, "AGENTS.md"), "utf8")
        expect((await syncCodexProjection(plan, { dryRun: true })).success).toBe(true)
        expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(before)
        expect((await syncCodexProjection(plan)).success).toBe(true)
        expect(await lstat(join(root, legacyPath)).catch(() => undefined)).toBeUndefined()
        const agents = await readFile(join(root, "AGENTS.md"), "utf8")
        expect(agents.startsWith(userGuidance)).toBe(true)
        expect(agents).not.toContain("$astrail-records")
        expect(agents).not.toContain("Task records and durable knowledge")
        for (const [path, content] of Object.entries(documents)) {
          expect(await readFile(join(root, path), "utf8")).toBe(content)
        }
        expect(await pathExists(join(root, "legacy-package/skills/astrail-records/SKILL.md"))).toBe(
          true,
        )
        expect((await doctorCodexProjection(workspace)).data.current).toBe(true)
        expect((await planCodexProjection(workspace)).changes).toEqual([])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it("removes the verified dangling old link after the package was upgraded", async () => {
    const root = await legacyWorkspace("link")
    try {
      await rm(join(root, "legacy-package"), { recursive: true })
      const plan = await planCodexProjection(await resolveWorkspace({ cwd: root }))
      expect((await syncCodexProjection(plan)).success).toBe(true)
      expect(await lstat(join(root, legacyPath)).catch(() => undefined)).toBeUndefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(["modified-copy", "replaced-link", "replaced-directory", "added-symlink"])(
    "preserves a %s and does not update the managed instructions",
    async (modification) => {
      const strategy =
        modification === "modified-copy" || modification === "added-symlink" ? "copy" : "link"
      const root = await legacyWorkspace(strategy)
      try {
        const entry = join(root, legacyPath)
        await file(root, "user-skill/SKILL.md", "# User-owned work\n")
        if (modification === "modified-copy") {
          await writeFile(join(entry, "SKILL.md"), "# User customization\n")
        } else if (modification === "added-symlink") {
          await symlink(join(root, "user-skill"), join(entry, "custom"))
        } else {
          await rm(entry)
          if (modification === "replaced-link") await symlink(join(root, "user-skill"), entry)
          else await file(root, `${legacyPath}/SKILL.md`, "# Replacement\n")
        }
        const before = await readFile(join(root, "AGENTS.md"), "utf8")
        const plan = await planCodexProjection(await resolveWorkspace({ cwd: root }))
        expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "ASTR5030" }))
        expect((await syncCodexProjection(plan)).success).toBe(false)
        expect(await lstat(entry)).toBeDefined()
        expect(await readFile(join(root, "user-skill/SKILL.md"), "utf8")).toBe(
          "# User-owned work\n",
        )
        expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(before)
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it("rechecks a copied legacy entry changed after the preview", async () => {
    const root = await legacyWorkspace("copy")
    try {
      const plan = await planCodexProjection(await resolveWorkspace({ cwd: root }))
      expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
      await writeFile(join(root, legacyPath, "SKILL.md"), "# Changed after preview\n")
      const before = await readFile(join(root, "AGENTS.md"), "utf8")
      const result = await syncCodexProjection(plan)
      expect(result.success).toBe(false)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "ASTR5030" }))
      expect(await readFile(join(root, legacyPath, "SKILL.md"), "utf8")).toBe(
        "# Changed after preview\n",
      )
      expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("does not delete an unowned old-name entry when the projection manifest is missing", async () => {
    const root = await legacyWorkspace("copy")
    try {
      await rm(join(root, ".astrail/projection-manifest.json"))
      const plan = await planCodexProjection(await resolveWorkspace({ cwd: root }))
      expect(
        plan.changes.some((item) => item.kind === "remove" && item.path === join(root, legacyPath)),
      ).toBe(false)
      await syncCodexProjection(plan)
      expect(await readFile(join(root, legacyPath, "SKILL.md"), "utf8")).toBe(
        "# Historical records Skill\n",
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("exposes a shared-config Skill only when selected, without adding records rules to AGENTS", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-records-optional-"))
    try {
      await file(root, "astrail.yaml", manifest("link"))
      let plan = await planCodexProjection(await resolveWorkspace({ cwd: root }))
      expect(plan.artifacts.some((item) => item.identity === legacyIdentity)).toBe(false)
      expect((await syncCodexProjection(plan)).success).toBe(true)
      const baseline = await readFile(join(root, "AGENTS.md"), "utf8")
      await file(root, "workflow/skills/records-workflow/SKILL.md", "# External docs and records\n")
      await file(
        root,
        "workflow/astrail.config.yaml",
        `capabilities:
  records-workflow:
    kind: skill
    identity: example/records-workflow
    source: { type: config, path: skills/records-workflow }
`,
      )
      await file(
        root,
        "astrail.yaml",
        `${manifest("link")}extends: [./workflow/astrail.config.yaml]\n`,
      )
      plan = await planCodexProjection(await resolveWorkspace({ cwd: root }))
      expect((await syncCodexProjection(plan)).success).toBe(true)
      expect(await readFile(join(root, ".agents/skills/records-workflow/SKILL.md"), "utf8")).toBe(
        "# External docs and records\n",
      )
      expect(await readFile(join(root, "AGENTS.md"), "utf8")).toBe(baseline)
      await file(root, "astrail.yaml", manifest("link"))
      expect(
        (
          await syncCodexProjection(
            await planCodexProjection(await resolveWorkspace({ cwd: root })),
          )
        ).success,
      ).toBe(true)
      expect(await pathExists(join(root, ".agents/skills/records-workflow"))).toBe(false)
      expect(await pathExists(join(root, "workflow/skills/records-workflow/SKILL.md"))).toBe(true)
      expect(await pathExists(join(root, "docs"))).toBe(false)
      expect(await pathExists(join(root, "records"))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
