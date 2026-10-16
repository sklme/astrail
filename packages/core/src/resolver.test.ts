import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { runProcess } from "./process.js"
import { resolveWorkspace } from "./resolver.js"

describe("repository topology resolution", () => {
  it.each([
    [{ branch: "main", branches: { backend: "feature/api" } }, undefined],
    [{ branches: { frontend: "main", backend: "feature/api" } }, undefined],
    [{ branches: { frontend: "main" } }, "ASTR2023"],
    [{ branch: "main", branches: { other: "feature/api" } }, "ASTR2022"],
  ])("validates and preserves environment branch maps: %j", async (checkout, error) => {
    const root = await mkdtemp(join(tmpdir(), "astrail-environment-mapping-"))
    await writeFile(
      join(root, "astrail.yaml"),
      JSON.stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "mapping" },
        repositories: Object.fromEntries(
          ["frontend", "backend"].map((id) => [
            id,
            {
              access: "read-write",
              source: { type: "git", url: `https://example.invalid/${id}.git` },
            },
          ]),
        ),
        environments: { default: { repositories: ["frontend", "backend"], checkout } },
      }),
    )
    const workspace = await resolveWorkspace({ cwd: root })
    if (error)
      expect(workspace.diagnostics).toContainEqual(expect.objectContaining({ code: error }))
    else {
      expect(workspace.diagnostics.filter((item) => item.severity === "error")).toEqual([])
      expect(workspace.topology.environments[0]?.checkout).toEqual(checkout)
    }
  })

  it("diagnoses managed Git destinations that cannot be safely materialized", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-invalid-managed-git-"))
    const destination = join(root, "repos", "platform")
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, "README.md"), "not git\n")
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: invalid-managed-git
repositories:
  platform:
    access: read-write
    source:
      type: git
      url: https://example.invalid/platform.git
`,
    )

    const invalid = await resolveWorkspace({ cwd: root, observe: true })
    expect(invalid.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR2004", severity: "error" }),
    )

    const gitRoot = await mkdtemp(join(tmpdir(), "astrail-missing-origin-"))
    const gitDestination = join(gitRoot, "repos", "platform")
    await mkdir(gitDestination, { recursive: true })
    expect((await runProcess("git", ["init", gitDestination])).exitCode).toBe(0)
    await writeFile(
      join(gitRoot, "astrail.yaml"),
      await readFile(join(root, "astrail.yaml"), "utf8"),
    )
    const missingOrigin = await resolveWorkspace({ cwd: gitRoot, observe: true })
    expect(missingOrigin.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR2005", severity: "warning" }),
    )
  })

  it("keeps environments optional and resolves one branch across explicit repositories", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-optional-environments-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: optional-environments
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
environments:
  resources-only:
    provider: static
    resources:
      endpoint: https://example.invalid
  feature-a:
    repositories: [frontend, backend]
    checkout:
      branch: feature/a
`,
    )

    const workspace = await resolveWorkspace({ cwd: root })
    expect(workspace.topology.environments).toEqual([
      {
        id: "feature-a",
        repositories: ["frontend", "backend"],
        checkout: { branch: "feature/a" },
        resources: {},
      },
      {
        id: "resources-only",
        repositories: [],
        provider: "static",
        resources: { endpoint: "https://example.invalid" },
      },
    ])
    expect(workspace.diagnostics.filter((item) => item.severity === "error")).toEqual([])

    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: no-environments
repositories:
  frontend:
    access: read-write
    source:
      type: git
      url: https://example.invalid/frontend.git
`,
    )
    const withoutEnvironment = await resolveWorkspace({ cwd: root })
    expect(withoutEnvironment.topology.environments).toEqual([])
    expect(withoutEnvironment.topology.repositories[0]?.source).toEqual({
      type: "git",
      url: "https://example.invalid/frontend.git",
    })
  })

  it("rejects incomplete checkout environments and unknown members", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-invalid-environment-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: invalid-environment
repositories:
  frontend:
    access: read-write
    source:
      type: git
      url: https://example.invalid/frontend.git
environments:
  incomplete:
    repositories: [frontend]
  unknown:
    repositories: [frontend, backend]
    checkout:
      branch: feature/a
`,
    )

    const workspace = await resolveWorkspace({ cwd: root })
    expect(workspace.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["ASTR2020", "ASTR2021"]),
    )
  })

  it("resolves Git, local, and monorepo subpath sources deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-repository-topology-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: topology
repositories:
  platform:
    description: Shared platform source
    role: platform
    access: read-write
    source:
      type: git
      url: https://example.invalid/platform.git
  api:
    access: read-only
    source:
      type: subpath
      repository: platform
      path: packages/api
  reference:
    access: read-only
    required: false
    source:
      type: local
      path: ../reference
capabilities:
  api-skill:
    kind: skill
    identity: example/api-skill
    source:
      type: repository
      repository: api
      path: skills/api-skill
`,
    )

    const workspace = await resolveWorkspace({ cwd: root })
    expect(workspace.topology.repositories).toMatchObject([
      {
        id: "api",
        source: { type: "subpath", repository: "platform", relativePath: "packages/api" },
        path: join(root, "repos", "platform", "packages", "api"),
        access: "read-only",
        required: true,
      },
      {
        id: "platform",
        source: { type: "git", url: "https://example.invalid/platform.git" },
        path: join(root, "repos", "platform"),
        access: "read-write",
        required: true,
        description: "Shared platform source",
        role: "platform",
      },
      {
        id: "reference",
        source: { type: "local", declaredPath: "../reference" },
        path: join(root, "..", "reference"),
        access: "read-only",
        required: false,
      },
    ])
    expect(workspace.capabilities[0]?.path).toBe(
      join(root, "repos", "platform", "packages", "api", "skills", "api-skill"),
    )
    expect(workspace.diagnostics.filter((item) => item.severity === "error")).toEqual([])
  })

  it("rejects unsafe, unknown, cyclic, incomplete, and access-widening subpaths", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-invalid-topology-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: invalid-topology
repositories:
  parent:
    access: read-only
    source:
      type: local
      path: parent
  wider-child:
    access: read-write
    source:
      type: subpath
      repository: parent
      path: packages/api
  escaping-child:
    access: read-only
    source:
      type: subpath
      repository: parent
      path: ../outside
  missing-parent:
    access: read-only
    source:
      type: subpath
      repository: absent
      path: packages/api
  cycle-a:
    access: read-only
    source:
      type: subpath
      repository: cycle-b
      path: a
  cycle-b:
    access: read-only
    source:
      type: subpath
      repository: cycle-a
      path: b
  incomplete-local:
    access: read-only
    source:
      type: local
`,
    )

    const workspace = await resolveWorkspace({ cwd: root })
    const codes = workspace.diagnostics.map((item) => item.code)
    expect(codes).toContain("ASTR2014")
    expect(codes).toContain("ASTR2015")
    expect(codes).toContain("ASTR2016")
    expect(codes).toContain("ASTR2017")
    expect(codes).toContain("ASTR2018")
  })

  it("scopes subpath dirty observations to the child directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-subpath-observation-"))
    const platform = join(root, "repos", "platform")
    await mkdir(join(platform, "packages", "api"), { recursive: true })
    await mkdir(join(platform, "packages", "sibling"), { recursive: true })
    expect((await runProcess("git", ["init", platform])).exitCode).toBe(0)
    await writeFile(join(platform, "packages", "api", "contract.proto"), "message Request {}\n")
    await writeFile(join(platform, "packages", "sibling", "index.ts"), "export {}\n")
    expect((await runProcess("git", ["-C", platform, "add", "."])).exitCode).toBe(0)
    expect(
      (
        await runProcess("git", [
          "-C",
          platform,
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
  name: subpath-observation
repositories:
  platform:
    access: read-write
    source:
      type: git
      url: ${JSON.stringify(platform)}
  api:
    access: read-only
    source:
      type: subpath
      repository: platform
      path: packages/api
`,
    )

    await writeFile(join(platform, "packages", "sibling", "index.ts"), "export const x = 1\n")
    const siblingDirty = await resolveWorkspace({ cwd: root, observe: true })
    expect(
      siblingDirty.topology.repositories.find((repository) => repository.id === "api")?.observation
        ?.dirty,
    ).toBe(false)

    await writeFile(
      join(platform, "packages", "api", "contract.proto"),
      "message Request { string id = 1; }\n",
    )
    const childDirty = await resolveWorkspace({ cwd: root, observe: true })
    expect(
      childDirty.topology.repositories.find((repository) => repository.id === "api")?.observation
        ?.dirty,
    ).toBe(true)
    expect(
      childDirty.diagnostics.some(
        (item) => item.code === "ASTR2002" && item.message.includes("api"),
      ),
    ).toBe(true)
  })
})
