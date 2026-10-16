import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { applyRepositoryAddition, planRepositoryAddition } from "./repository-authoring.js"

const manifest = `# user header
apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: authoring
extensions:
  keep: exactly
`

describe("repository authoring", () => {
  it("plans a Git repository with deterministic defaults without writing or cloning", async () => {
    const root = await workspace("astrail-authoring-git-")
    const request = {
      source: { type: "git" as const, url: "https://example.invalid/Team/Application.git" },
    }
    const plan = await planRepositoryAddition(request, { cwd: root })

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR7013", severity: "information" }),
    )
    expect(plan.addition).toMatchObject({
      id: "application",
      requestedTarget: "auto",
      selectedTarget: "shared",
      repository: {
        required: true,
        access: "read-write",
        source: { type: "git", url: "https://example.invalid/Team/Application.git" },
      },
    })
    expect(plan.addition?.repository).not.toHaveProperty("description")
    expect(plan.files).toHaveLength(1)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(manifest)

    const described = await planRepositoryAddition(
      { ...request, description: "  Customer application service  ", role: "frontend" },
      { cwd: root },
    )
    expect(described.addition?.repository).toMatchObject({
      description: "Customer application service",
      role: "frontend",
    })
    expect(described.diagnostics.some((item) => item.code === "ASTR7013")).toBe(false)
    expect(described.planId).not.toBe(plan.planId)
  })

  it("splits an absolute local source across shared policy and local path", async () => {
    const root = await workspace("astrail-authoring-local-")
    const plan = await planRepositoryAddition(
      {
        id: "foundation",
        prepare: false,
        source: { type: "local", path: "/opt/reference/foundation" },
        description: "Shared engineering foundations",
        role: "foundation",
      },
      { cwd: root },
    )

    expect(plan.addition).toMatchObject({
      selectedTarget: "split",
      repository: { access: "read-only" },
    })
    expect(plan.files.map((file) => file.target)).toEqual(["local", "shared"])
    const applied = await applyRepositoryAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(true)
    expect(applied.data.repository).toMatchObject({
      id: "foundation",
      source: { type: "local", declaredPath: "/opt/reference/foundation" },
      access: "read-only",
      description: "Shared engineering foundations",
      role: "foundation",
    })
    const shared = await readFile(join(root, "astrail.yaml"), "utf8")
    const local = await readFile(join(root, "astrail.local.yaml"), "utf8")
    expect(shared).toContain("type: local")
    expect(shared).not.toContain("/opt/reference/foundation")
    expect(shared).toContain("description: Shared engineering foundations")
    expect(shared).toContain("role: foundation")
    expect(local).toContain("path: /opt/reference/foundation")
    expect(local).not.toContain("Shared engineering foundations")
    expect(shared).toContain("# user header")
    expect(shared).toContain("keep: exactly")
  })

  it("uses parent access defaults and resolver-compatible subpath diagnostics", async () => {
    const root = await workspace(
      "astrail-authoring-subpath-",
      `${manifest}repositories:
  platform:
    access: read-only
    source:
      type: git
      url: https://example.invalid/platform.git
`,
    )
    const valid = await planRepositoryAddition(
      {
        id: "api",
        source: { type: "subpath", repository: "platform", path: "packages/api" },
      },
      { cwd: root },
    )
    expect(valid.addition?.repository.access).toBe("read-only")
    expect(valid.diagnostics.filter((item) => item.severity === "error")).toEqual([])

    const widening = await planRepositoryAddition(
      {
        id: "api",
        access: "read-write",
        source: { type: "subpath", repository: "platform", path: "packages/api" },
      },
      { cwd: root },
    )
    expect(widening.diagnostics.some((item) => item.code === "ASTR2017")).toBe(true)
    expect(widening.files).toEqual([])

    const escaping = await planRepositoryAddition(
      {
        id: "escape",
        source: { type: "subpath", repository: "platform", path: "../outside" },
      },
      { cwd: root },
    )
    expect(escaping.diagnostics.some((item) => item.code === "ASTR2016")).toBe(true)
  })

  it("rejects mixed or unknown source fields instead of silently ignoring them", async () => {
    const root = await workspace("astrail-authoring-exclusive-")
    const plan = await planRepositoryAddition(
      {
        id: "mixed",
        source: {
          type: "git",
          url: "https://example.invalid/mixed.git",
          path: "unexpected/local/path",
        },
      },
      { cwd: root },
    )
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR7001", message: "Unknown Git source field path" }),
    )
    expect(plan.files).toEqual([])
  })

  it("reuses identical declarations and refuses conflicts, mismatched plan IDs, and stale files", async () => {
    const root = await workspace("astrail-authoring-stale-")
    const request = {
      id: "service",
      prepare: false,
      source: { type: "git" as const, url: "https://example.invalid/service.git" },
    }
    const plan = await planRepositoryAddition(request, { cwd: root })
    const mismatch = await applyRepositoryAddition(plan, {
      authorized: true,
      expectedPlanId: "different",
    })
    expect(mismatch.diagnostics.some((item) => item.code === "ASTR7007")).toBe(true)

    await writeFile(join(root, "astrail.yaml"), `${manifest}# concurrent edit\n`)
    const stale = await applyRepositoryAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(stale.diagnostics.some((item) => item.code === "ASTR7008")).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toContain("# concurrent edit")

    const current = await planRepositoryAddition(request, { cwd: root })
    expect((await applyRepositoryAddition(current, { authorized: true })).success).toBe(true)
    const duplicate = await planRepositoryAddition(request, { cwd: root })
    expect(duplicate.diagnostics.some((item) => item.code === "ASTR7002")).toBe(false)
    expect(duplicate.registration).toBe("reuse")
    expect(duplicate.files).toEqual([])
    const conflict = await planRepositoryAddition(
      { ...request, description: "Different intent" },
      { cwd: root },
    )
    expect(conflict.diagnostics.some((item) => item.code === "ASTR7002")).toBe(true)
  })
})

async function workspace(prefix: string, content = manifest): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(join(root, "astrail.yaml"), content)
  return root
}
