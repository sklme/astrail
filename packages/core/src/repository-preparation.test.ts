import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { stringify } from "yaml"
import { pathExists } from "./fs.js"
import * as gitOperations from "./git.js"
import { inspectRepository } from "./git.js"
import { runProcess } from "./process.js"
import { applyRepositoryAddition, planRepositoryAddition } from "./repository-authoring.js"

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("repository addition preparation", () => {
  it("preserves a destination occupied by another process during clone", async () => {
    const root = await workspace()
    const remote = await gitFixture(root)
    const destination = join(root, "repos/service")
    const clone = gitOperations.cloneRepository
    vi.spyOn(gitOperations, "cloneRepository").mockImplementation(async (...args) => {
      await clone(...args)
      await mkdir(destination)
      await writeFile(join(destination, "keep"), "concurrent user data")
    })
    const plan = await planRepositoryAddition(
      { id: "service", source: { type: "git", url: remote } },
      { cwd: root },
    )
    const result = await applyRepositoryAddition(plan, { authorized: true })
    expect(result).toMatchObject({
      success: false,
      data: { applied: true, preparation: { status: "failed" } },
    })
    expect(await readFile(join(destination, "keep"), "utf8")).toBe("concurrent user data")
    expect(await readdir(join(root, "repos"))).toEqual(["service"])
  })

  it("previews registration and clone, then prepares only the added repository", async () => {
    const root = await workspace()
    const remote = await gitFixture(root)
    await writeManifest(root, {
      repositories: {
        unrelated: {
          access: "read-write",
          source: { type: "git", url: join(root, "unavailable") },
        },
      },
    })
    const request = { id: "service", source: { type: "git", url: remote } }
    const plan = await planRepositoryAddition(request, { cwd: root })
    expect(plan.actions.map((action) => action.type)).toEqual(["write", "clone"])
    expect(plan.preparation.entries.map((entry) => entry.repository.id)).toEqual(["service"])
    expect(await pathExists(join(root, "repos"))).toBe(false)
    expect((await applyRepositoryAddition(plan)).success).toBe(false)
    expect(await pathExists(join(root, "repos"))).toBe(false)
    const result = await applyRepositoryAddition(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(result).toMatchObject({
      success: true,
      data: { applied: true, preparation: { status: "ready" } },
    })
    expect(await readFile(join(root, "repos/service/README.md"), "utf8")).toBe("fixture\n")
    expect(await pathExists(join(root, "repos/unrelated"))).toBe(false)
    expect(await pathExists(join(root, "AGENTS.md"))).toBe(false)
    expect(await pathExists(join(root, ".agents"))).toBe(false)
    expect(await pathExists(join(root, ".astrail/cache"))).toBe(false)

    const before = await readFile(join(root, "astrail.yaml"), "utf8")
    await writeFile(join(root, "repos/service/README.md"), "user change\n")
    const retry = await planRepositoryAddition(request, { cwd: root })
    expect(retry.files).toEqual([])
    expect(retry.actions.map((action) => action.type)).toEqual(["check"])
    expect((await applyRepositoryAddition(retry, { authorized: true })).success).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)
    expect(await readFile(join(root, "repos/service/README.md"), "utf8")).toBe("user change\n")
  })

  it("preserves registration after failure and retries an identical request", async () => {
    const root = await workspace()
    const remote = join(root, "remote")
    const request = { id: "service", source: { type: "git", url: remote } }
    const plan = await planRepositoryAddition(request, { cwd: root })
    const failed = await applyRepositoryAddition(plan, { authorized: true })
    expect(failed).toMatchObject({
      success: false,
      data: { applied: true, preparation: { status: "failed" } },
    })
    const registered = await readFile(join(root, "astrail.yaml"), "utf8")
    expect(registered).toContain("service:")
    expect(await readdir(join(root, "repos"))).toEqual([])
    await gitFixture(root)
    const retry = await planRepositoryAddition(request, { cwd: root })
    expect(retry.registration).toBe("reuse")
    expect(retry.files).toEqual([])
    expect((await applyRepositoryAddition(retry, { authorized: true })).success).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(registered)
  })

  it("binds declaration-only mode and revisions to the plan and cleans failed checkout", async () => {
    const root = await workspace()
    const remote = await gitFixture(root)
    const request = {
      id: "service",
      source: {
        type: "git",
        url: remote,
        revision: { commit: "0123456789012345678901234567890123456789" },
      },
    }
    const plan = await planRepositoryAddition(request, { cwd: root })
    const declaration = await planRepositoryAddition({ ...request, prepare: false }, { cwd: root })
    expect(declaration.planId).not.toBe(plan.planId)
    expect(declaration.actions.map((action) => action.type)).toEqual(["write"])
    expect(
      (
        await applyRepositoryAddition(plan, {
          authorized: true,
          expectedPlanId: declaration.planId,
        })
      ).success,
    ).toBe(false)
    expect(
      (await applyRepositoryAddition(declaration, { authorized: true })).data.preparation?.status,
    ).toBe("skipped")
    expect(await pathExists(join(root, "repos/service"))).toBe(false)
    const retry = await planRepositoryAddition(request, { cwd: root })
    expect(
      (await applyRepositoryAddition(retry, { authorized: true })).data.preparation?.status,
    ).toBe("failed")
    expect(await readdir(join(root, "repos"))).toEqual([])
  })

  it.each(["branch", "tag", "commit"] as const)("honors a requested %s", async (kind) => {
    const root = await workspace()
    const remote = await gitFixture(root)
    const revision =
      kind === "branch"
        ? "main"
        : kind === "tag"
          ? "v1"
          : (await inspectRepository(remote)).revision
    const request = {
      id: "service",
      source: { type: "git", url: remote, revision: { [kind]: revision } },
    }
    const plan = await planRepositoryAddition(request, { cwd: root })
    expect((await applyRepositoryAddition(plan, { authorized: true })).success).toBe(true)
    expect((await inspectRepository(join(root, "repos/service"))).revision).toBe(
      (await inspectRepository(remote)).revision,
    )
    const again = await planRepositoryAddition(request, { cwd: root })
    expect(again.diagnostics.filter((item) => item.severity === "error")).toEqual([])
  })

  it("includes missing source ancestors and checks subpaths after clone", async () => {
    const root = await workspace()
    const remote = await gitFixture(root)
    await writeManifest(root, {
      repositories: {
        platform: { access: "read-write", source: { type: "git", url: remote } },
        packages: {
          access: "read-write",
          source: { type: "subpath", repository: "platform", path: "packages" },
        },
      },
    })
    const plan = await planRepositoryAddition(
      { id: "api", source: { type: "subpath", repository: "packages", path: "api" } },
      { cwd: root },
    )
    expect(plan.preparation.entries.map((entry) => entry.repository.id)).toEqual([
      "platform",
      "packages",
      "api",
    ])
    expect(
      plan.actions.filter((action) => action.type === "clone").map((action) => action.id),
    ).toEqual(["clone:platform"])
    expect((await applyRepositoryAddition(plan, { authorized: true })).success).toBe(true)
    expect(await pathExists(join(root, "repos/platform/packages/api/index.ts"))).toBe(true)
    expect(await pathExists(join(root, "repos/api"))).toBe(false)
  })

  it("reports a missing subpath after cloning and preserves registration", async () => {
    const root = await workspace()
    const remote = await gitFixture(root)
    await writeManifest(root, {
      repositories: { platform: { access: "read-write", source: { type: "git", url: remote } } },
    })
    const plan = await planRepositoryAddition(
      { id: "missing", source: { type: "subpath", repository: "platform", path: "missing" } },
      { cwd: root },
    )
    const failed = await applyRepositoryAddition(plan, { authorized: true })
    expect(failed).toMatchObject({
      success: false,
      data: { applied: true, preparation: { status: "failed" } },
    })
    expect(await pathExists(join(root, "repos/platform/.git"))).toBe(true)
  })

  it("rejects changed destinations and local overrides before registration", async () => {
    const root = await workspace()
    const request = { id: "service", source: { type: "git", url: join(root, "remote") } }
    const plan = await planRepositoryAddition(request, { cwd: root })
    const before = await readFile(join(root, "astrail.yaml"), "utf8")
    await mkdir(join(root, "repos/service"), { recursive: true })
    await writeFile(join(root, "repos/service/keep"), "user file")
    const changed = await applyRepositoryAddition(plan, { authorized: true })
    expect(changed.diagnostics.some((item) => item.code === "ASTR7008")).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)
    expect(await readFile(join(root, "repos/service/keep"), "utf8")).toBe("user file")
    const collision = await planRepositoryAddition(request, { cwd: root })
    expect(collision.diagnostics.some((item) => item.code === "ASTR7014")).toBe(true)
    await writeFile(
      join(root, "astrail.local.yaml"),
      "apiVersion: astrail.dev/v1alpha1\nkind: WorkspaceLocal\nrepositories:\n  service:\n    description: changed\n",
    )
    const stale = await applyRepositoryAddition(plan, { authorized: true })
    expect(stale.diagnostics.some((item) => item.code === "ASTR7008")).toBe(true)
  })

  it("rejects wrong-origin checkouts and symlink destinations", async () => {
    const root = await workspace()
    const remote = await gitFixture(root)
    await mkdir(join(root, "repos"))
    await git("clone", remote, join(root, "repos/service"))
    const request = { id: "service", source: { type: "git", url: join(root, "other") } }
    const conflict = await planRepositoryAddition(request, { cwd: root })
    expect(conflict.diagnostics.some((item) => item.message.includes("origin conflicts"))).toBe(
      true,
    )
    await symlink(remote, join(root, "repos/linked"))
    const linked = await planRepositoryAddition(
      { id: "linked", source: { type: "git", url: remote } },
      { cwd: root },
    )
    expect(linked.diagnostics.some((item) => item.code === "ASTR7014")).toBe(true)
  })

  it("reuses split local declarations and validates local availability", async () => {
    const root = await workspace()
    const local = join(root, "local")
    const request = { id: "local", source: { type: "local", path: local } }
    expect(
      (await planRepositoryAddition(request, { cwd: root })).diagnostics.some(
        (item) => item.code === "ASTR7014",
      ),
    ).toBe(true)
    await mkdir(local)
    const plan = await planRepositoryAddition(request, { cwd: root })
    expect((await applyRepositoryAddition(plan, { authorized: true })).success).toBe(true)
    const retry = await planRepositoryAddition(request, { cwd: root })
    expect(retry.registration).toBe("reuse")
    expect(retry.files).toEqual([])
    expect((await applyRepositoryAddition(retry, { authorized: true })).success).toBe(true)
  })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "astrail-onboarding-"))
  roots.push(root)
  await writeManifest(root)
  return root
}

async function writeManifest(root: string, fields: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    join(root, "astrail.yaml"),
    stringify({
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "onboarding" },
      ...fields,
    }),
  )
}

async function git(...args: string[]): Promise<void> {
  const result = await runProcess("git", args)
  expect(result.exitCode, result.stderr).toBe(0)
}

async function gitFixture(root: string): Promise<string> {
  const remote = join(root, "remote")
  await git("init", "-b", "main", remote)
  await mkdir(join(remote, "packages/api"), { recursive: true })
  await writeFile(join(remote, "README.md"), "fixture\n")
  await writeFile(join(remote, "packages/api/index.ts"), "export {}\n")
  await git("-C", remote, "add", ".")
  await git(
    "-C",
    remote,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    "fixture",
  )
  await git("-C", remote, "tag", "v1")
  return remote
}
