import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  applyEnvironmentCheckout,
  getEnvironmentCheckoutStatus,
  getEnvironmentCheckoutStatuses,
  planEnvironmentCheckout,
} from "./environment-checkout.js"
import { doctorWorkspace, workspaceStatus } from "./lifecycle.js"
import { runProcess } from "./process.js"

async function branchFixture(checkout: object, subpath = false) {
  const root = await mkdtemp(join(tmpdir(), "astrail-per-repository-branches-"))
  const first = await createRepository(root, "first")
  const second = await createRepository(root, "second")
  await addBranch(first, "feature/first")
  await addBranch(second, "feature/second")
  await mkdir(join(first, "packages", "api"), { recursive: true })
  const manifest = {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "branches" },
    repositories: {
      first: { access: "read-write", source: { type: "local", path: first } },
      second: {
        access: "read-write",
        source: subpath
          ? { type: "subpath", repository: "first", path: "packages/api" }
          : { type: "local", path: second },
      },
    },
    environments: { default: { repositories: ["first", "second"], checkout } },
  }
  const save = () => writeFile(join(root, "astrail.yaml"), JSON.stringify(manifest))
  await save()
  return { root, first, second, manifest, save }
}

async function createRepository(root: string, name: string): Promise<string> {
  const repository = join(root, name)
  await mkdir(repository, { recursive: true })
  expect((await runProcess("git", ["init", "-b", "main", repository])).exitCode).toBe(0)
  await writeFile(join(repository, "README.md"), `${name}\n`)
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
  return repository
}

async function addBranch(repository: string, branch = "feature/a"): Promise<void> {
  expect((await runProcess("git", ["-C", repository, "branch", branch])).exitCode).toBe(0)
}

describe("environment checkout", () => {
  it.each([
    { branch: "feature/first", branches: { second: "feature/second" } },
    { branches: { first: "feature/first", second: "feature/second" } },
  ])("switches and verifies distinct branch targets: %j", async (checkout) => {
    const { root } = await branchFixture(checkout)
    const plan = await planEnvironmentCheckout("default", { cwd: root })
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(plan.actions.map((action) => action.toBranch)).toEqual([
      "feature/first",
      "feature/second",
    ])
    const unauthorized = await applyEnvironmentCheckout(plan)
    expect(unauthorized.success).toBe(false)
    const applied = await applyEnvironmentCheckout(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(true)
    expect(applied.data.status?.consistent).toBe(true)
    expect(
      applied.data.status?.repositories.map((repository) => [
        repository.desiredBranch,
        repository.currentBranch,
      ]),
    ).toEqual([
      ["feature/first", "feature/first"],
      ["feature/second", "feature/second"],
    ])
    const again = await planEnvironmentCheckout("default", { cwd: root })
    expect(again.actions.map((action) => action.type)).toEqual(["noop", "noop"])
  })

  it("deduplicates matching overrides but rejects conflicting physical checkout targets everywhere", async () => {
    const checkout = { branch: "feature/first", branches: { second: "feature/first" } }
    const { root, manifest, save } = await branchFixture(checkout, true)
    const matching = await planEnvironmentCheckout("default", { cwd: root })
    expect(matching.actions).toHaveLength(1)
    expect(matching.actions[0]?.repositories).toEqual(["first", "second"])
    manifest.environments.default.checkout = { ...checkout, branches: { second: "main" } }
    await save()
    const plan = await planEnvironmentCheckout("default", { cwd: root })
    expect(plan.actions).toEqual([])
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ASTR7313",
        message: expect.stringContaining("second=main"),
      }),
    )
    expect((await applyEnvironmentCheckout(plan, { authorized: true })).success).toBe(false)
    for (const result of [
      await getEnvironmentCheckoutStatus("default", { cwd: root }),
      await getEnvironmentCheckoutStatuses({ cwd: root }),
      await workspaceStatus({ cwd: root }),
      await doctorWorkspace({ cwd: root }),
    ]) {
      expect(result.success).toBe(false)
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "ASTR7313" }))
    }
    const status = await getEnvironmentCheckoutStatus("default", { cwd: root })
    expect(status.data?.consistent).toBe(false)
    expect(status.data?.repositories.map((repository) => repository.currentBranch)).toEqual([
      "main",
      "main",
    ])
  })

  it("rejects a reviewed plan when an effective override changes", async () => {
    const { root, manifest, save } = await branchFixture({
      branch: "main",
      branches: { second: "feature/second" },
    })
    const plan = await planEnvironmentCheckout("default", { cwd: root })
    manifest.environments.default.checkout = {
      branch: "main",
      branches: { first: "feature/first" },
    }
    await save()
    const applied = await applyEnvironmentCheckout(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(false)
    expect(applied.diagnostics).toContainEqual(expect.objectContaining({ code: "ASTR7309" }))
    expect(applied.data.completedActions).toEqual([])
  })

  it.each([
    [{ branch: "main", branches: { second: "missing" } }, "ASTR7306"],
    [{ branch: "main", branches: { second: "bad branch" } }, "ASTR7303"],
    [{ branches: { second: "feature/second" } }, "ASTR2023"],
    [{ branch: "main", branches: { unknown: "feature/second" } }, "ASTR2022"],
  ])("refuses unsafe branch mappings before switching: %j", async (checkout, code) => {
    const { root } = await branchFixture(checkout)
    const plan = await planEnvironmentCheckout("default", { cwd: root })
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code }))
    const applied = await applyEnvironmentCheckout(plan, { authorized: true })
    expect(applied.success).toBe(false)
    expect(applied.data.completedActions).toEqual([])
  })

  it("checks dirtiness against each target and permits dirty no-ops", async () => {
    const { root, first, manifest, save } = await branchFixture({
      branch: "main",
      branches: { second: "feature/second" },
    })
    await writeFile(join(first, "README.md"), "dirty\n")
    const noop = await planEnvironmentCheckout("default", { cwd: root })
    expect(noop.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    manifest.environments.default.checkout = {
      branch: "main",
      branches: { first: "feature/first" },
    }
    await save()
    const dirty = await planEnvironmentCheckout("default", { cwd: root })
    expect(dirty.diagnostics).toContainEqual(expect.objectContaining({ code: "ASTR7305" }))
    expect(
      (await applyEnvironmentCheckout(dirty, { authorized: true })).data.completedActions,
    ).toEqual([])
  })

  it("reports status, deduplicates subpaths, and switches one physical checkout", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-environment-checkout-"))
    const platform = await createRepository(root, "platform")
    await mkdir(join(platform, "packages", "api"), { recursive: true })
    await addBranch(platform)
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: checkout
repositories:
  platform:
    access: read-write
    source:
      type: local
      path: ${JSON.stringify(platform)}
  api:
    access: read-write
    source:
      type: subpath
      repository: platform
      path: packages/api
environments:
  feature-a:
    repositories: [platform, api]
    checkout:
      branch: feature/a
  resources-only:
    provider: static
`,
    )

    const before = await getEnvironmentCheckoutStatus("feature-a", { cwd: root })
    expect(before.success).toBe(true)
    expect(before.data).toMatchObject({
      configured: true,
      desiredBranch: "feature/a",
      consistent: false,
    })
    expect(before.data?.repositories.map((item) => item.status)).toEqual([
      "mismatched",
      "mismatched",
    ])

    const plan = await planEnvironmentCheckout("feature-a", { cwd: root })
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(plan.actions).toHaveLength(1)
    expect(plan.actions[0]).toMatchObject({
      type: "switch",
      path: await realpath(platform),
      repositories: ["api", "platform"],
      fromBranch: "main",
      toBranch: "feature/a",
    })
    const unauthorized = await applyEnvironmentCheckout(plan)
    expect(unauthorized.success).toBe(false)

    const applied = await applyEnvironmentCheckout(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(true)
    expect(applied.data.status?.consistent).toBe(true)
    expect(
      (await runProcess("git", ["-C", platform, "branch", "--show-current"])).stdout.trim(),
    ).toBe("feature/a")

    const resourcesOnly = await getEnvironmentCheckoutStatus("resources-only", { cwd: root })
    expect(resourcesOnly.success).toBe(true)
    expect(resourcesOnly.data).toMatchObject({ configured: false, consistent: false })
    const allStatuses = await getEnvironmentCheckoutStatuses({ cwd: root })
    expect(allStatuses.data).toEqual([
      expect.objectContaining({
        environment: "feature-a",
        configured: true,
        consistent: true,
      }),
      expect.objectContaining({
        environment: "resources-only",
        configured: false,
        consistent: false,
        repositories: [],
      }),
    ])
    const resourcesPlan = await planEnvironmentCheckout("resources-only", { cwd: root })
    expect(resourcesPlan.diagnostics.some((item) => item.code === "ASTR7302")).toBe(true)
  })

  it("refuses missing branches, dirty switches, missing paths, and non-Git roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-environment-unsafe-"))
    const repository = await createRepository(root, "repository")
    const plain = join(root, "plain")
    await mkdir(plain)
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: unsafe-checkout
repositories:
  repository:
    access: read-write
    source:
      type: local
      path: ${JSON.stringify(repository)}
  plain:
    access: read-write
    source:
      type: local
      path: ${JSON.stringify(plain)}
  missing:
    access: read-write
    required: false
    source:
      type: local
      path: ${JSON.stringify(join(root, "missing"))}
environments:
  feature-a:
    repositories: [repository]
    checkout:
      branch: feature/a
  invalid-roots:
    repositories: [plain, missing]
    checkout:
      branch: feature/a
`,
    )

    const missingBranch = await planEnvironmentCheckout("feature-a", { cwd: root })
    expect(missingBranch.diagnostics.some((item) => item.code === "ASTR7306")).toBe(true)
    await addBranch(repository)
    await writeFile(join(repository, "README.md"), "dirty\n")
    const dirty = await planEnvironmentCheckout("feature-a", { cwd: root })
    expect(dirty.diagnostics.some((item) => item.code === "ASTR7305")).toBe(true)

    const invalidRoots = await planEnvironmentCheckout("invalid-roots", { cwd: root })
    expect(invalidRoots.diagnostics.filter((item) => item.code === "ASTR7304")).toHaveLength(2)
  })

  it("rejects stale observations and reports partial execution without atomicity claims", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-environment-partial-"))
    const first = await createRepository(root, "first")
    const second = await createRepository(root, "second")
    await addBranch(first)
    await addBranch(second)
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: partial-checkout
repositories:
  first:
    access: read-write
    source: { type: local, path: ${JSON.stringify(first)} }
  second:
    access: read-write
    source: { type: local, path: ${JSON.stringify(second)} }
environments:
  feature-a:
    repositories: [first, second]
    checkout: { branch: feature/a }
`,
    )

    const stalePlan = await planEnvironmentCheckout("feature-a", { cwd: root })
    expect((await runProcess("git", ["-C", first, "switch", "feature/a"])).exitCode).toBe(0)
    const stale = await applyEnvironmentCheckout(stalePlan, {
      authorized: true,
      expectedPlanId: stalePlan.planId,
    })
    expect(stale.success).toBe(false)
    expect(stale.diagnostics.some((item) => item.code === "ASTR7309")).toBe(true)
    expect((await runProcess("git", ["-C", first, "switch", "main"])).exitCode).toBe(0)

    const plan = await planEnvironmentCheckout("feature-a", { cwd: root })
    let calls = 0
    const partial = await applyEnvironmentCheckout(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
      async switchBranch(path, branch) {
        calls += 1
        if (calls === 2) return { stdout: "", stderr: "simulated failure", exitCode: 1 }
        return runProcess("git", ["-C", path, "switch", "--", branch])
      },
    })
    expect(partial.success).toBe(false)
    expect(partial.diagnostics.some((item) => item.code === "ASTR7310")).toBe(true)
    expect(partial.data.completedActions).toHaveLength(1)
    expect(partial.data.remainingActions).toHaveLength(1)
  })
})
