import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { pathExists } from "./fs.js"
import { applySkillAddition, planSkillAddition } from "./skill-authoring.js"

const manifest = `# user header
apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: skill-authoring
extensions:
  keep: exactly
`

describe("Skill authoring", () => {
  it("plans and applies a direct Git Skill without acquisition", async () => {
    const root = await workspace("astrail-skill-authoring-git-")
    const request = {
      identity: "example/loghelper",
      version: "1.2.0",
      source: {
        type: "git" as const,
        url: "https://example.invalid/team-skills.git",
        revision: { tag: "v1.2.0" },
        path: "skills/loghelper",
      },
      trust: { instructions: "trusted" as const },
    }
    const plan = await planSkillAddition(request, { cwd: root })

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(plan.addition).toMatchObject({
      id: "loghelper",
      capability: {
        kind: "skill",
        identity: "example/loghelper",
        exposeAs: "loghelper",
        source: request.source,
      },
    })
    expect(plan.files).toHaveLength(1)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(manifest)

    const refused = await applySkillAddition(plan)
    expect(refused.diagnostics.some((item) => item.code === "ASTR7106")).toBe(true)
    const applied = await applySkillAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(true)
    expect(applied.data.capability).toMatchObject({
      id: "loghelper",
      identity: "example/loghelper",
      exposeAs: "loghelper",
      source: request.source,
    })
    const content = await readFile(join(root, "astrail.yaml"), "utf8")
    expect(content).toContain("# user header")
    expect(content).toContain("keep: exactly")
    expect(content).toContain("capabilities:")
    expect(await pathExists(join(root, ".agents", "skills", "loghelper"))).toBe(false)
  })

  it("normalizes Workspace and repository-owned Skill sources", async () => {
    const root = await workspace(
      "astrail-skill-authoring-paths-",
      `${manifest}repositories:
  platform:
    access: read-only
    source:
      type: local
      path: repositories/platform
`,
    )
    const workspacePlan = await planSkillAddition(
      {
        identity: "company/workspace-guide",
        source: { type: "workspace", path: "skills/workspace-guide" },
      },
      { cwd: root },
    )
    expect(workspacePlan.addition).toMatchObject({
      id: "workspace-guide",
      capability: {
        exposeAs: "workspace-guide",
        source: { type: "workspace", path: "skills/workspace-guide" },
      },
    })

    const repositoryPlan = await planSkillAddition(
      {
        id: "api-skill",
        identity: "company/api",
        exposeAs: "api-helper",
        source: { type: "repository", repository: "platform", path: "skills/api" },
      },
      { cwd: root },
    )
    expect(repositoryPlan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(repositoryPlan.addition).toMatchObject({
      id: "api-skill",
      capability: {
        exposeAs: "api-helper",
        source: { type: "repository", repository: "platform", path: "skills/api" },
      },
    })
  })

  it("rejects unsafe, incomplete, conflicting, and unknown Skill input", async () => {
    const root = await workspace(
      "astrail-skill-authoring-invalid-",
      `${manifest}capabilities:
  existing:
    kind: skill
    identity: company/existing
    exposeAs: existing
    source:
      type: workspace
      path: skills/existing
`,
    )
    const invalid = await planSkillAddition(
      {
        identity: "company/new",
        exposeAs: "existing",
        source: {
          type: "git",
          url: "https://example.invalid/skills.git",
          revision: { branch: "main" },
          path: "../outside",
          extra: true,
        },
        trust: { instructions: "sometimes" },
      },
      { cwd: root },
    )
    expect(invalid.files).toEqual([])
    expect(invalid.diagnostics.filter((item) => item.severity === "error").length).toBeGreaterThan(
      3,
    )
    expect(
      invalid.diagnostics.some((item) =>
        item.message.includes("Unknown Git Skill source field extra"),
      ),
    ).toBe(true)
    expect(invalid.diagnostics.some((item) => item.message.includes("safely relative"))).toBe(true)
    expect(invalid.diagnostics.some((item) => item.message.includes("alias existing"))).toBe(true)

    const incompleteRevision = await planSkillAddition(
      {
        identity: "company/incomplete",
        source: {
          type: "git",
          url: "https://example.invalid/skills.git",
          revision: { branch: "main", tag: "v1" },
          path: "skills/incomplete",
        },
      },
      { cwd: root },
    )
    expect(
      incompleteRevision.diagnostics.some((item) => item.message.includes("requires one branch")),
    ).toBe(true)
    expect(incompleteRevision.files).toEqual([])

    const unknownRepository = await planSkillAddition(
      {
        identity: "company/repository-skill",
        source: { type: "repository", repository: "missing", path: "skills/example" },
      },
      { cwd: root },
    )
    expect(unknownRepository.diagnostics.some((item) => item.code === "ASTR7103")).toBe(true)
    expect(unknownRepository.files).toEqual([])
  })

  it("refuses mismatched and stale plans without overwriting concurrent edits", async () => {
    const root = await workspace("astrail-skill-authoring-stale-")
    const plan = await planSkillAddition(
      {
        identity: "company/example",
        source: { type: "workspace", path: "skills/example" },
      },
      { cwd: root },
    )
    const mismatch = await applySkillAddition(plan, {
      authorized: true,
      expectedPlanId: "different",
    })
    expect(mismatch.diagnostics.some((item) => item.code === "ASTR7107")).toBe(true)

    await writeFile(join(root, "astrail.yaml"), `${manifest}# concurrent edit\n`)
    const stale = await applySkillAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(stale.diagnostics.some((item) => item.code === "ASTR7108")).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toContain("# concurrent edit")
  })

  it("restores the manifest when composed verification rejects the applied result", async () => {
    const root = await workspace("astrail-skill-authoring-rollback-")
    const plan = await planSkillAddition(
      {
        identity: "company/example",
        source: { type: "workspace", path: "skills/example" },
      },
      { cwd: root },
    )
    if (!plan.addition) throw new Error("expected Skill addition")
    plan.addition.capability = {
      ...plan.addition.capability,
      identity: "company/unexpected",
    }

    const applied = await applySkillAddition(plan, { authorized: true })
    expect(applied.success).toBe(false)
    expect(applied.diagnostics.some((item) => item.code === "ASTR7110")).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(manifest)
  })
})

async function workspace(prefix: string, content = manifest): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(root, "astrail.yaml"), content)
  return root
}
