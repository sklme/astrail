import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import {
  applyEnvironmentAddition,
  type EnvironmentAdditionRequest,
  planEnvironmentAddition,
} from "./environment-authoring.js"

async function fixture(): Promise<{ root: string; manifest: string }> {
  const root = await mkdtemp(join(tmpdir(), "astrail-environment-authoring-"))
  const manifest = join(root, "astrail.yaml")
  await writeFile(
    manifest,
    `# preserve this comment
apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: environment-authoring
repositories:
  frontend:
    access: read-write
    source:
      type: git
      url: https://example.invalid/frontend.git
  backend:
    access: read-write
    source:
      type: git
      url: https://example.invalid/backend.git
extensions:
  example.test: preserved
`,
  )
  return { root, manifest }
}

const request: EnvironmentAdditionRequest = {
  id: "feature-a",
  repositories: ["frontend", "backend"],
  branch: "feature/a",
  provider: "static",
  resources: { endpoint: "https://feature-a.example.invalid" },
}

describe("environment authoring", () => {
  it.each([
    { branch: "main", branches: { backend: "feature/api" } },
    { branches: { frontend: "main", backend: "feature/api" } },
  ])("round-trips branch mappings through reviewed authoring: %j", async (checkout) => {
    const { root, manifest } = await fixture()
    const before = await readFile(manifest, "utf8")
    const input = { id: "default", repositories: ["frontend", "backend"], ...checkout }
    const plan = await planEnvironmentAddition(input, { cwd: root })
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(plan.addition?.environment.checkout).toEqual(checkout)
    expect(await readFile(manifest, "utf8")).toBe(before)
    const applied = await applyEnvironmentAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(true)
    expect(applied.data.environment?.checkout).toEqual(checkout)
    expect(parse(await readFile(manifest, "utf8")).environments.default.checkout).toEqual(checkout)
  })

  it.each([
    { branches: { frontend: "main" } },
    { branch: "main", branches: { unknown: "feature/a" } },
    { branch: "main", branches: { frontend: "" } },
    { branch: "main", branches: { frontend: 3 } },
    { branch: "main", branches: [] },
    { branch: "main", branches: {} },
  ])("rejects incomplete or invalid branch mappings: %j", async (checkout) => {
    const { root, manifest } = await fixture()
    const before = await readFile(manifest, "utf8")
    const plan = await planEnvironmentAddition(
      { id: "default", repositories: ["frontend", "backend"], ...checkout },
      { cwd: root },
    )
    expect(plan.diagnostics.some((item) => item.severity === "error")).toBe(true)
    expect(plan.files).toEqual([])
    expect(await readFile(manifest, "utf8")).toBe(before)
  })

  it("plans without mutation and applies only the reviewed environment", async () => {
    const { root, manifest } = await fixture()
    const before = await readFile(manifest, "utf8")
    const plan = await planEnvironmentAddition(request, { cwd: root })

    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(plan.addition).toMatchObject({
      id: "feature-a",
      environment: {
        repositories: ["backend", "frontend"],
        checkout: { branch: "feature/a" },
      },
    })
    expect(await readFile(manifest, "utf8")).toBe(before)

    const unauthorized = await applyEnvironmentAddition(plan)
    expect(unauthorized.success).toBe(false)
    expect(await readFile(manifest, "utf8")).toBe(before)

    const applied = await applyEnvironmentAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(true)
    expect(applied.data.environment).toMatchObject({
      id: "feature-a",
      repositories: ["backend", "frontend"],
      checkout: { branch: "feature/a" },
    })
    const content = await readFile(manifest, "utf8")
    expect(content).toContain("# preserve this comment")
    expect(parse(content)).toMatchObject({
      extensions: { "example.test": "preserved" },
      environments: {
        "feature-a": {
          repositories: ["backend", "frontend"],
          checkout: { branch: "feature/a" },
        },
      },
    })
  })

  it("rejects unknown repositories, duplicate environments, and stale plans", async () => {
    const { root, manifest } = await fixture()
    const unknown = await planEnvironmentAddition(
      { ...request, repositories: ["frontend", "missing"] },
      { cwd: root },
    )
    expect(unknown.diagnostics.some((item) => item.code === "ASTR2021")).toBe(true)
    expect(unknown.files).toEqual([])

    const plan = await planEnvironmentAddition(request, { cwd: root })
    await writeFile(manifest, `${await readFile(manifest, "utf8")}# concurrent edit\n`)
    const stale = await applyEnvironmentAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(stale.success).toBe(false)
    expect(stale.diagnostics.some((item) => item.code === "ASTR7208")).toBe(true)

    const current = await planEnvironmentAddition(request, { cwd: root })
    const applied = await applyEnvironmentAddition(current, {
      authorized: true,
      expectedPlanId: current.planId,
    })
    expect(applied.success).toBe(true)
    const duplicate = await planEnvironmentAddition(request, { cwd: root })
    expect(duplicate.diagnostics.some((item) => item.code === "ASTR7202")).toBe(true)
  })

  it("validates machine input without prompting or partial plans", async () => {
    const { root } = await fixture()
    const invalid = await planEnvironmentAddition(
      { id: "Feature A", repositories: [], branch: "" },
      { cwd: root },
    )
    expect(invalid.addition).toBeNull()
    expect(invalid.files).toEqual([])
    expect(invalid.diagnostics.some((item) => item.code === "ASTR7201")).toBe(true)
  })
})
