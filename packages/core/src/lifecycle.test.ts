import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import {
  applyBootstrap,
  applyFilePlan,
  doctorWorkspace,
  planBootstrap,
  planLock,
  planUpdate,
  restorePreviousLock,
  workspaceStatus,
} from "./lifecycle.js"
import { runProcess } from "./process.js"
import { resolveWorkspace } from "./resolver.js"

describe("lifecycle", () => {
  it("aggregates environment status and diagnoses inconsistent and unsupported runtimes", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-doctor-environment-"))
    const repository = join(root, "repository")
    await mkdir(repository)
    expect((await runProcess("git", ["init", "-b", "main", repository])).exitCode).toBe(0)
    await writeFile(join(repository, "README.md"), "fixture\n")
    await mkdir(join(repository, "skills", "workspace-guide"), { recursive: true })
    await writeFile(
      join(repository, "skills", "workspace-guide", "SKILL.md"),
      "---\nname: workspace-guide\ndescription: Workspace guide\n---\n",
    )
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
    expect((await runProcess("git", ["-C", repository, "branch", "feature/a"])).exitCode).toBe(0)
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: doctor-environment
repositories:
  platform:
    access: read-write
    source: { type: local, path: ${JSON.stringify(repository)} }
environments:
  feature-a:
    repositories: [platform]
    checkout: { branch: feature/a }
  resources-only:
    provider: static
`,
    )

    const status = await workspaceStatus({ cwd: root })
    expect(status.data.environmentStatuses).toEqual([
      expect.objectContaining({ environment: "feature-a", configured: true, consistent: false }),
      expect.objectContaining({ environment: "resources-only", configured: false }),
    ])
    const doctor = await doctorWorkspace({ cwd: root })
    expect(doctor.success).toBe(true)
    expect(doctor.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6003", severity: "warning" }),
    )
    expect(doctor.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6004", severity: "information" }),
    )
    expect(doctor.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6005", severity: "information" }),
    )
    expect(doctor.data.repositorySkills).toMatchObject({
      discovered: 1,
      imported: 0,
      unimported: 1,
      importable: 1,
    })
    expect(doctor.data.tools.nodeSupported).toBe(true)

    const strict = await doctorWorkspace({ cwd: root, strict: true })
    expect(strict.success).toBe(false)
    expect(strict.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6003", severity: "error" }),
    )
    expect(strict.data.workspace.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6003", severity: "error" }),
    )
    expect(strict.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6005", severity: "information" }),
    )
    const unsupported = await doctorWorkspace({ cwd: root }, { nodeVersion: "20.0.0" })
    expect(unsupported.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6002", severity: "error" }),
    )
  })

  it("reports missing repository descriptions once without failing strict doctor", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-doctor-descriptions-"))
    const alpha = join(root, "alpha")
    const zeta = join(root, "zeta")
    await mkdir(alpha)
    await mkdir(zeta)
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: doctor-descriptions
repositories:
  zeta:
    access: read-only
    source: { type: local, path: ${JSON.stringify(zeta)} }
  alpha:
    access: read-only
    source: { type: local, path: ${JSON.stringify(alpha)} }
`,
    )

    const normal = await doctorWorkspace({ cwd: root })
    expect(normal.success).toBe(true)
    expect(normal.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ASTR6005",
        severity: "information",
        details: { repositories: ["alpha", "zeta"] },
      }),
    )

    const strict = await doctorWorkspace({ cwd: root, strict: true })
    expect(strict.success).toBe(true)
    expect(strict.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6005", severity: "information" }),
    )

    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: doctor-descriptions
repositories:
  zeta:
    description: Zeta service
    access: read-only
    source: { type: local, path: ${JSON.stringify(zeta)} }
  alpha:
    description: Alpha service
    access: read-only
    source: { type: local, path: ${JSON.stringify(alpha)} }
`,
    )
    const described = await doctorWorkspace({ cwd: root, strict: true })
    expect(described.success).toBe(true)
    expect(described.diagnostics.some((item) => item.code === "ASTR6005")).toBe(false)
  })

  it("writes lock state atomically and becomes idempotent", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-lock-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: lock-test
`,
    )
    const workspace = await resolveWorkspace({ cwd: root })
    const first = await planLock(workspace)
    expect(first.actions).toHaveLength(1)
    await applyFilePlan(root, first, {})
    const content = await readFile(join(root, "astrail.lock.yaml"), "utf8")
    expect(content).toContain("kind: WorkspaceLock")
    const secondWorkspace = await resolveWorkspace({ cwd: root })
    const second = await planLock(secondWorkspace)
    expect(second.actions).toHaveLength(0)
  })

  it("records acquired Git capability provenance without retaining content", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-git-capability-lock-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: git-capability-lock
capabilities:
  loghelper:
    kind: skill
    identity: example/loghelper
    version: 1.2.0
    source:
      type: git
      url: https://example.invalid/team-skills.git
      revision:
        tag: v1.2.0
      path: skills/loghelper
    trust:
      instructions: trusted
`,
    )
    const workspace = await resolveWorkspace({ cwd: root })
    const unresolved = await planLock(workspace)
    expect(unresolved.diagnostics.some((item) => item.code === "ASTR6203")).toBe(true)

    const plan = await planLock(workspace, {
      acquisitions: [
        {
          capabilityId: "loghelper",
          source: {
            type: "git",
            url: "https://example.invalid/team-skills.git",
            revision: { tag: "v1.2.0" },
            path: "skills/loghelper",
          },
          resolvedCommit: "abc123",
          integrity: "sha256-fixture",
        },
      ],
    })
    expect(plan.diagnostics).toEqual([])
    await applyFilePlan(root, plan, {})
    const lock = parse(await readFile(join(root, "astrail.lock.yaml"), "utf8"))
    expect(lock.capabilities.loghelper).toEqual({
      identity: "example/loghelper",
      version: "1.2.0",
      source: {
        type: "git",
        url: "https://example.invalid/team-skills.git",
        revision: { tag: "v1.2.0" },
        path: "skills/loghelper",
        resolvedCommit: "abc123",
      },
      integrity: "sha256-fixture",
    })
    const loaded = await resolveWorkspace({ cwd: root })
    expect(loaded.diagnostics.filter((item) => item.severity === "error")).toEqual([])
  })

  it("updates from declarations without lock constraints and restores prior lock state", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-update-"))
    const manifestPath = join(root, "astrail.yaml")
    const manifest = (version: string) => `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: update-test
capabilities:
  tool:
    kind: tool
    identity: astrail/tool
    version: ${version}
    source:
      type: builtin
`
    await writeFile(manifestPath, manifest("1.0.0"))
    const initial = await resolveWorkspace({ cwd: root })
    await applyFilePlan(root, await planLock(initial), {})

    await writeFile(manifestPath, manifest("2.0.0"))
    const updated = await resolveWorkspace({ cwd: root, ignoreLock: true })
    const updatePlan = await planUpdate(updated)
    expect(updatePlan.actions).toHaveLength(1)
    await applyFilePlan(root, updatePlan, {})
    const currentLock = parse(await readFile(join(root, "astrail.lock.yaml"), "utf8"))
    expect(currentLock.capabilities.tool.version).toBe("2.0.0")

    const restored = await restorePreviousLock(root)
    expect(restored.success).toBe(true)
    const previousLock = parse(await readFile(join(root, "astrail.lock.yaml"), "utf8"))
    expect(previousLock.capabilities.tool.version).toBe("1.0.0")
  })

  it("acquires a Git config only with authorization and records its resolution", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-git-config-"))
    const source = await mkdtemp(join(tmpdir(), "astrail-config-source-"))
    expect((await runProcess("git", ["init", source])).exitCode).toBe(0)
    await writeFile(
      join(source, "astrail.config.yaml"),
      `apiVersion: astrail.dev/v1alpha1
metadata:
  name: community/backend
  version: 1.4.0
contexts:
  backend-guide:
    kind: builtin
    provider: repository-list
`,
    )
    expect((await runProcess("git", ["-C", source, "add", "astrail.config.yaml"])).exitCode).toBe(0)
    expect(
      (
        await runProcess("git", [
          "-C",
          source,
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
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: git-config
extends:
  - git: ${JSON.stringify(source)}
`,
    )

    const unresolved = await resolveWorkspace({ cwd: root, observe: true })
    const bootstrap = await planBootstrap(unresolved)
    expect(bootstrap.actions.map((action) => action.id)).toEqual([
      `acquire-config:${unresolved.configs[0]?.key}`,
    ])
    expect((await applyBootstrap(unresolved, bootstrap, { authorized: false })).success).toBe(false)
    expect((await applyBootstrap(unresolved, bootstrap, { authorized: true })).success).toBe(true)

    const resolved = await resolveWorkspace({ cwd: root })
    expect(resolved.contexts.map((context) => context.id)).toContain("backend-guide")
    const lockPlan = await planLock(resolved)
    await applyFilePlan(root, lockPlan, {})
    const lock = parse(await readFile(join(root, "astrail.lock.yaml"), "utf8"))
    const entry = lock.configs[resolved.configs[0]?.key ?? ""]
    expect(entry).toMatchObject({
      source: { type: "git", url: source, path: "astrail.config.yaml" },
    })
    expect(entry.resolvedCommit).toMatch(/^[a-f0-9]{40}$/)
    expect(entry.integrity).toMatch(/^sha256-/)
  })

  it("clones one managed Git source and makes its subpaths available", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-git-repository-"))
    const source = await mkdtemp(join(tmpdir(), "astrail-git-repository-source-"))
    expect((await runProcess("git", ["init", source])).exitCode).toBe(0)
    await mkdir(join(source, "packages", "api"), { recursive: true })
    await writeFile(join(source, "packages", "api", "contract.proto"), "message Request {}\n")
    expect((await runProcess("git", ["-C", source, "add", "."])).exitCode).toBe(0)
    expect(
      (
        await runProcess("git", [
          "-C",
          source,
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
    const branch = (
      await runProcess("git", ["-C", source, "branch", "--show-current"])
    ).stdout.trim()
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: git-repository
repositories:
  platform:
    access: read-write
    source:
      type: git
      url: ${JSON.stringify(source)}
      revision:
        branch: ${JSON.stringify(branch)}
  api:
    access: read-only
    source:
      type: subpath
      repository: platform
      path: packages/api
`,
    )

    const unresolved = await resolveWorkspace({ cwd: root, observe: true })
    const plan = await planBootstrap(unresolved)
    expect(plan.actions).toEqual([
      expect.objectContaining({
        id: "clone:platform",
        type: "clone",
        target: join(root, "repos", "platform"),
      }),
    ])
    expect((await applyBootstrap(unresolved, plan, { authorized: false })).success).toBe(false)
    expect((await applyBootstrap(unresolved, plan, { authorized: true })).success).toBe(true)

    const resolved = await resolveWorkspace({ cwd: root, observe: true })
    expect(resolved.topology.repositories.map((repository) => repository.id)).toEqual([
      "api",
      "platform",
    ])
    expect(
      resolved.topology.repositories.every(
        (repository) => repository.observation?.present === true,
      ),
    ).toBe(true)
    expect((await planBootstrap(resolved)).actions).toEqual([])
  })

  it("plans review but never activates an untrusted executable Plugin", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-plugin-review-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: plugin-review
capabilities:
  company-provider:
    kind: plugin
    identity: example/company-provider
    version: 1.0.0
    trust:
      executable: prompt
`,
    )
    const workspace = await resolveWorkspace({ cwd: root, observe: true })
    expect(workspace.capabilities[0]?.active).toBe(false)
    const plan = await planBootstrap(workspace)
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        id: "review-plugin:company-provider",
        type: "review-plugin",
        requiresAuthorization: true,
      }),
    )
    expect((await applyBootstrap(workspace, plan, { authorized: false })).success).toBe(false)
    expect((await applyBootstrap(workspace, plan, { authorized: true })).success).toBe(true)
    const afterReview = await resolveWorkspace({ cwd: root })
    expect(afterReview.capabilities[0]?.active).toBe(false)
  })
})
