import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { pathExists } from "./fs.js"
import {
  applySkillImport,
  discoverRepositorySkills,
  planSkillImport,
  summarizeRepositorySkillDiscovery,
} from "./skill-discovery.js"

describe("repository Skill discovery", () => {
  it("discovers supported shallow conventions deterministically without mutation", async () => {
    const root = await workspace("astrail-skill-discover-")
    await skill(root, "platform", ".agents/skills/api", "api", "API helper")
    await skill(root, "platform", "skills/logs", "logs", "Log helper")
    await skill(root, "client", ".codex/skills/client", "client-tools", "Client helper")
    await mkdir(join(root, "repos", "platform", "skills", "broken"), { recursive: true })
    await writeFile(
      join(root, "repos", "platform", "skills", "broken", "SKILL.md"),
      "# missing frontmatter\n",
    )
    const before = await readFile(join(root, "astrail.yaml"), "utf8")

    const discovered = await discoverRepositorySkills({ all: true }, { cwd: root })

    expect(discovered.candidates.map((candidate) => candidate.key)).toEqual([
      "client:.codex/skills/client",
      "platform:.agents/skills/api",
      "platform:skills/broken",
      "platform:skills/logs",
    ])
    expect(discovered.candidates[0]).toMatchObject({
      name: "client-tools",
      proposedIdentity: "client/client-tools",
      proposedId: "client-tools",
      instructionsTrusted: false,
      importable: true,
    })
    expect(discovered.candidates.find((candidate) => candidate.name === "api")).toMatchObject({
      description: "API helper",
      instructionsTrusted: true,
    })
    expect(
      discovered.candidates.find((candidate) => candidate.path === "skills/broken"),
    ).toMatchObject({
      importable: false,
      diagnostics: [{ code: "ASTR7203" }],
    })
    expect(summarizeRepositorySkillDiscovery(discovered)).toMatchObject({
      repositories: ["client", "managed", "monorepo", "platform", "unavailable"],
      discovered: 4,
      imported: 0,
      unimported: 4,
      importable: 3,
      candidates: [
        expect.objectContaining({ repository: "client", path: ".codex/skills/client" }),
        expect.objectContaining({ repository: "platform", path: ".agents/skills/api" }),
        expect.objectContaining({ repository: "platform", path: "skills/broken" }),
        expect.objectContaining({ repository: "platform", path: "skills/logs" }),
      ],
    })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)
    expect(await pathExists(join(root, ".agents"))).toBe(false)
  })

  it("supports subpath repositories, scoped discovery, and safe symlink containment", async () => {
    const root = await workspace("astrail-skill-discover-subpath-", true)
    await skill(root, "monorepo/packages/api", "skills/api", "api", "API")
    await skill(root, "managed", "skills/managed", "managed", "Managed Git source")
    const outside = await mkdtemp(join(tmpdir(), "astrail-skill-outside-"))
    await skillDirectory(outside, "escaped", "Escaped")
    await mkdir(join(root, "repos", "monorepo", ".agents", "skills"), { recursive: true })
    await symlink(outside, join(root, "repos", "monorepo", ".agents", "skills", "escaped"))

    const scoped = await discoverRepositorySkills({ repositories: ["api"] }, { cwd: root })
    expect(scoped.candidates.map((candidate) => candidate.key)).toEqual(["api:skills/api"])
    const managed = await discoverRepositorySkills({ repositories: ["managed"] }, { cwd: root })
    expect(managed.candidates.map((candidate) => candidate.key)).toEqual(["managed:skills/managed"])

    const unknown = await discoverRepositorySkills(
      { repositories: ["missing", "unavailable"] },
      { cwd: root },
    )
    expect(unknown.diagnostics.some((item) => item.code === "ASTR7201")).toBe(true)
    expect(unknown.diagnostics.some((item) => item.code === "ASTR7202")).toBe(true)

    const parent = await discoverRepositorySkills({ repositories: ["monorepo"] }, { cwd: root })
    expect(parent.candidates.some((candidate) => candidate.name === "escaped")).toBe(false)
  })

  it("reports declarations and deterministic identity, ID, and alias conflicts", async () => {
    const root = await workspace("astrail-skill-discover-conflict-")
    await skill(root, "platform", "skills/api", "api", "API")
    await skill(root, "client", "skills/api", "api", "Client API")
    await writeFile(
      join(root, "astrail.yaml"),
      `${await readFile(join(root, "astrail.yaml"), "utf8")}capabilities:\n  platform-api:\n    kind: skill\n    identity: platform/api\n    exposeAs: api\n    source:\n      type: repository\n      repository: platform\n      path: skills/api\n`,
    )

    const discovered = await discoverRepositorySkills({ all: true }, { cwd: root })
    const platform = discovered.candidates.find((candidate) => candidate.repository === "platform")
    const client = discovered.candidates.find((candidate) => candidate.repository === "client")
    expect(platform).toMatchObject({ alreadyDeclared: true, existingCapability: "platform-api" })
    expect(client?.conflicts.map((conflict) => conflict.field)).toEqual(["id", "alias"])
  })
})

describe("selective Skill import", () => {
  it("previews and atomically applies only the selected candidates", async () => {
    const root = await workspace("astrail-skill-import-")
    await skill(root, "platform", "skills/api", "api", "API")
    await skill(root, "platform", "skills/logs", "logs", "Logs")
    const before = await readFile(join(root, "astrail.yaml"), "utf8")
    const request = {
      selections: [
        {
          repository: "platform",
          path: "skills/logs",
          identity: "company/logs",
          exposeAs: "workspace-logs",
          trust: { instructions: "trusted" as const },
        },
      ],
    }

    const plan = await planSkillImport(request, { cwd: root })
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(plan.additions).toMatchObject([
      {
        id: "logs",
        capability: {
          kind: "skill",
          identity: "company/logs",
          exposeAs: "workspace-logs",
          source: { type: "repository", repository: "platform", path: "skills/logs" },
          trust: { instructions: "trusted" },
        },
      },
    ])
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)

    const refused = await applySkillImport(plan)
    expect(refused.diagnostics.some((item) => item.code === "ASTR7221")).toBe(true)
    const applied = await applySkillImport(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(applied.success).toBe(true)
    expect(applied.data.capabilities.map((capability) => capability.id)).toEqual(["logs"])
    const content = await readFile(join(root, "astrail.yaml"), "utf8")
    expect(content).toContain("workspace-logs")
    expect(content).not.toContain("company/api")
    expect(await pathExists(join(root, ".agents", "skills", "workspace-logs"))).toBe(false)
  })

  it("validates current candidates and lets explicit overrides resolve batch conflicts", async () => {
    const root = await workspace("astrail-skill-import-conflicts-")
    await skill(root, "platform", "skills/api", "api", "API")
    await skill(root, "client", "skills/api", "api", "Client API")

    const conflict = await planSkillImport(
      {
        selections: [
          { repository: "platform", path: "skills/api" },
          { repository: "client", path: "skills/api" },
        ],
      },
      { cwd: root },
    )
    expect(conflict.files).toEqual([])
    expect(conflict.diagnostics.some((item) => item.message.includes("already exists"))).toBe(true)

    const resolved = await planSkillImport(
      {
        selections: [
          {
            repository: "platform",
            path: "skills/api",
            id: "platform-api",
            exposeAs: "platform-api",
          },
          { repository: "client", path: "skills/api", id: "client-api", exposeAs: "client-api" },
        ],
      },
      { cwd: root },
    )
    expect(resolved.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    expect(resolved.additions.map((addition) => addition.id)).toEqual([
      "platform-api",
      "client-api",
    ])

    const invalid = await planSkillImport(
      { selections: [{ repository: "platform", path: "../outside" }] },
      { cwd: root },
    )
    expect(invalid.files).toEqual([])
    expect(invalid.diagnostics.some((item) => item.code === "ASTR7210")).toBe(true)
  })

  it("refuses mismatched, stale source, and failed-verification plans without partial writes", async () => {
    const root = await workspace("astrail-skill-import-stale-")
    await skill(root, "platform", "skills/api", "api", "API")
    const request = { selections: [{ repository: "platform", path: "skills/api" }] }
    const plan = await planSkillImport(request, { cwd: root })
    const before = await readFile(join(root, "astrail.yaml"), "utf8")

    const mismatch = await applySkillImport(plan, { authorized: true, expectedPlanId: "wrong" })
    expect(mismatch.diagnostics.some((item) => item.code === "ASTR7222")).toBe(true)

    await skill(root, "platform", "skills/api", "api", "Changed")
    const stale = await applySkillImport(plan, {
      authorized: true,
      expectedPlanId: plan.planId,
    })
    expect(stale.diagnostics.some((item) => item.code === "ASTR7223")).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)

    const fresh = await planSkillImport(request, { cwd: root })
    const addition = fresh.additions[0]
    if (!addition) throw new Error("expected Skill import addition")
    addition.capability = {
      ...addition.capability,
      identity: "unexpected/identity",
    }
    const failed = await applySkillImport(fresh, { authorized: true })
    expect(failed.diagnostics.some((item) => item.code === "ASTR7226")).toBe(true)
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)
  })
})

async function workspace(prefix: string, subpath = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(root, "repos", "platform"), { recursive: true })
  await mkdir(join(root, "repos", "client"), { recursive: true })
  await mkdir(join(root, "repos", "monorepo", "packages", "api"), { recursive: true })
  await writeFile(
    join(root, "astrail.yaml"),
    `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: discovery
repositories:
  platform:
    access: read-write
    source:
      type: local
      path: repos/platform
    trust:
      instructions: trusted
  client:
    access: read-write
    source:
      type: local
      path: repos/client
  monorepo:
    access: read-write
    source:
      type: local
      path: repos/monorepo
  unavailable:
    required: false
    access: read-only
    source:
      type: local
      path: repos/unavailable
  managed:
    required: false
    access: read-only
    source:
      type: git
      url: https://example.invalid/managed.git
${subpath ? `  api:\n    access: read-write\n    source:\n      type: subpath\n      repository: monorepo\n      path: packages/api\n` : ""}`,
  )
  return root
}

async function skill(
  root: string,
  repositoryPath: string,
  path: string,
  name: string,
  description: string,
): Promise<void> {
  await skillDirectory(join(root, "repos", repositoryPath, path), name, description)
}

async function skillDirectory(path: string, name: string, description: string): Promise<void> {
  await mkdir(path, { recursive: true })
  await writeFile(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
  )
}
