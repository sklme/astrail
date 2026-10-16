import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  planEnvironmentAddition,
  planSkillAddition,
  planSkillImport,
  runProcess,
} from "astrail-core"
import { afterEach, describe, expect, it } from "vitest"
import { parse } from "yaml"
import type { EnvironmentPrompter } from "./environment-prompt.js"
import { CLI_VERSION, createProgram } from "./program.js"
import type { RepositoryPrompter } from "./repository-prompt.js"
import type { SkillImportPrompter, SkillPrompter } from "./skill-prompt.js"

describe("CLI", () => {
  const originalExitCode = process.exitCode
  afterEach(() => {
    process.exitCode = originalExitCode
  })

  it("reports the version declared by the CLI package", () => {
    expect(createProgram().version()).toBe(CLI_VERSION)
  })

  it("emits the same typed result through a stable JSON envelope", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-"))
    const stdout: string[] = []
    const stderr: string[] = []
    const init = createProgram({
      out: (value) => stdout.push(value),
      err: (value) => stderr.push(value),
    })
    await init.parseAsync(
      ["--json", "--cwd", root, "init", "--name", "cli-test", "--skip-install"],
      { from: "user" },
    )
    const envelope = JSON.parse(stdout.join("")) as Record<string, unknown>
    expect(envelope).toMatchObject({ schemaVersion: "1", command: "init", success: true })
    expect(stderr).toEqual([])
  })

  it("renders config human and JSON output from the same typed result", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-output-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: output-test
environments:
  staging:
    provider: static
`,
    )
    const humanOutput: string[] = []
    const jsonOutput: string[] = []
    await createProgram({
      out: (value) => humanOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--cwd", root, "config", "show"], { from: "user" })
    await createProgram({
      out: (value) => jsonOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "config", "show"], { from: "user" })
    const envelope = JSON.parse(jsonOutput.join("")) as { data: unknown }
    expect(parse(humanOutput.join(""))).toEqual(envelope.data)
    expect(Object.keys(JSON.parse(jsonOutput.join("")) as object)).toMatchInlineSnapshot(`
      [
        "schemaVersion",
        "command",
        "success",
        "data",
        "diagnostics",
        "meta",
      ]
    `)
  })

  it("aggregates top-level status and renders concise doctor output with strict consistency", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-inspection-"))
    const repository = await cliGitRepository(root, "platform")
    await mkdir(join(repository, "skills", "log"), { recursive: true })
    await writeFile(join(repository, "skills", "log", "SKILL.md"), "# Log\n")
    await mkdir(join(repository, "skills", "unimported"), { recursive: true })
    await writeFile(
      join(repository, "skills", "unimported", "SKILL.md"),
      "---\nname: unimported\ndescription: Unimported helper\n---\n",
    )
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: cli-inspection
repositories:
  platform:
    access: read-write
    source: { type: local, path: ${JSON.stringify(repository)} }
environments:
  feature-a:
    repositories: [platform]
    checkout: { branch: feature/a }
capabilities:
  logs:
    kind: skill
    identity: platform/logs
    exposeAs: logs
    source: { type: repository, repository: platform, path: skills/log }
    trust: { instructions: trusted }
`,
    )

    const statusJson: string[] = []
    await createProgram({
      out: (value) => statusJson.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "status"], { from: "user" })
    const status = JSON.parse(statusJson.join("")) as {
      success: boolean
      data: {
        capabilities: Array<{ path?: string }>
        environmentStatuses: Array<{ consistent: boolean }>
        codex: { manifestPresent: boolean; current: boolean; pendingActions: unknown[] }
      }
      meta: { workspaceRoot?: string }
    }
    expect(status.success).toBe(true)
    expect(status.data.capabilities[0]?.path).toBe(join(repository, "skills", "log"))
    expect(status.data.environmentStatuses[0]?.consistent).toBe(false)
    expect(status.data.codex).toMatchObject({ manifestPresent: false, current: false })
    expect(status.data.codex.pendingActions.length).toBeGreaterThan(0)
    expect(status.meta.workspaceRoot).toBe(root)

    const statusHuman: string[] = []
    await createProgram({
      out: (value) => statusHuman.push(value),
      err: () => undefined,
    }).parseAsync(["--cwd", root, "status"], { from: "user" })
    for (const section of ["Repositories", "Environments", "Capabilities", "Codex projection"]) {
      expect(statusHuman.join("")).toContain(section)
    }

    const doctorHuman: string[] = []
    const doctorErrors: string[] = []
    await createProgram({
      out: (value) => doctorHuman.push(value),
      err: (value) => doctorErrors.push(value),
    }).parseAsync(["--cwd", root, "doctor"], { from: "user" })
    for (const section of [
      "Workspace health:",
      "Tools",
      "Summary",
      "Unimported repository Skills",
    ]) {
      expect(doctorHuman.join("")).toContain(section)
    }
    expect(doctorHuman.join("")).not.toContain('"provenance"')
    expect(doctorErrors.join("")).toContain("ASTR6003")
    expect(doctorErrors.join("")).toContain("ASTR6004")
    expect(doctorErrors.join("")).toContain("ASTR6005")
    expect(doctorErrors.join("")).toContain("ASTR5020")

    const strictJson: string[] = []
    await createProgram({
      out: (value) => strictJson.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "doctor", "--strict"], { from: "user" })
    const strict = JSON.parse(strictJson.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string; severity: string }>
      data: {
        root: string
        workspace: { diagnostics: Array<{ code: string; severity: string }> }
        repositorySkills: { unimported: number; importable: number }
      }
      meta: { workspaceRoot?: string }
    }
    expect(strict.success).toBe(false)
    expect(strict.data.root).toBe(root)
    expect(strict.data.repositorySkills).toMatchObject({ unimported: 1, importable: 1 })
    expect(strict.meta.workspaceRoot).toBe(root)
    for (const code of ["ASTR6003", "ASTR5020"]) {
      expect(strict.diagnostics).toContainEqual(
        expect.objectContaining({ code, severity: "error" }),
      )
      expect(strict.data.workspace.diagnostics).toContainEqual(
        expect.objectContaining({ code, severity: "error" }),
      )
    }
    expect(strict.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6005", severity: "information" }),
    )
  })

  it("lists, shows, and explicitly loads context without routing a task", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-context-"))
    await mkdir(join(root, "docs"), { recursive: true })
    await writeFile(join(root, "docs", "guide.md"), "agent-selected guide")
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: context-catalog
contexts:
  guide:
    kind: file
    path: docs/guide.md
    summary: Optional guide
    trust: content-only
`,
    )

    const human: string[] = []
    await createProgram({ out: (value) => human.push(value), err: () => undefined }).parseAsync(
      ["--cwd", root, "context", "list"],
      { from: "user" },
    )
    expect(human.join("")).toContain("guide")

    const shown: string[] = []
    await createProgram({ out: (value) => shown.push(value), err: () => undefined }).parseAsync(
      ["--json", "--cwd", root, "context", "show", "guide"],
      { from: "user" },
    )
    const showEnvelope = JSON.parse(shown.join("")) as {
      data: { id: string; trust: string }
    }
    expect(showEnvelope.data).toMatchObject({ id: "guide", trust: "content-only" })
    expect(showEnvelope.data).not.toHaveProperty("content")

    const loaded: string[] = []
    await createProgram({ out: (value) => loaded.push(value), err: () => undefined }).parseAsync(
      ["--json", "--cwd", root, "context", "load", "guide"],
      { from: "user" },
    )
    const loadEnvelope = JSON.parse(loaded.join("")) as {
      data: { context: { id: string }; content: string }
    }
    expect(loadEnvelope.data).toMatchObject({
      context: { id: "guide" },
      content: "agent-selected guide",
    })

    const unknown: string[] = []
    await createProgram({ out: (value) => unknown.push(value), err: () => undefined }).parseAsync(
      ["--json", "--cwd", root, "context", "show", "missing"],
      { from: "user" },
    )
    const unknownEnvelope = JSON.parse(unknown.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(unknownEnvelope.success).toBe(false)
    expect(unknownEnvelope.diagnostics.some((item) => item.code === "ASTR8006")).toBe(true)
  })

  it("uses the refused-mutation exit code when bootstrap lacks authorization", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-refused-"))
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: refused
repositories:
  required:
    access: read-write
    source:
      type: git
      url: https://example.invalid/required.git
`,
    )
    await createProgram({ out: () => undefined, err: () => undefined }).parseAsync(
      ["--cwd", root, "bootstrap"],
      { from: "user" },
    )
    expect(process.exitCode).toBe(4)
  })

  it("reports unimported repository Skills during bootstrap without importing them", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-bootstrap-skills-"))
    const repository = join(root, "repository")
    await mkdir(join(repository, "skills", "workspace-guide"), { recursive: true })
    await writeFile(
      join(repository, "skills", "workspace-guide", "SKILL.md"),
      "---\nname: workspace-guide\ndescription: Workspace guide\n---\n",
    )
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: bootstrap-skills
repositories:
  platform:
    access: read-write
    source: { type: local, path: ${JSON.stringify(repository)} }
targets:
  codex: { type: codex, primary: true }
`,
    )
    const output: string[] = []
    await createProgram({ out: (value) => output.push(value), err: () => undefined }).parseAsync(
      ["--json", "--cwd", root, "bootstrap", "--dry-run"],
      { from: "user" },
    )
    const envelope = JSON.parse(output.join("")) as {
      success: boolean
      data: { repositorySkills: { unimported: number; importable: number } }
      diagnostics: Array<{ code: string; severity: string }>
    }
    expect(envelope.success).toBe(true)
    expect(envelope.data.repositorySkills).toMatchObject({ unimported: 1, importable: 1 })
    expect(envelope.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR6105", severity: "information" }),
    )
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).not.toContain("capabilities:")
  })

  it("previews, authorizes, and locks a direct Git Skill without a capability cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-git-skill-"))
    const repository = await mkdtemp(join(tmpdir(), "astrail-cli-git-source-"))
    await mkdir(join(repository, "skills", "loghelper"), { recursive: true })
    await writeFile(join(repository, "skills", "loghelper", "SKILL.md"), "# Remote Skill\n")
    expect((await runProcess("git", ["init", repository])).exitCode).toBe(0)
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
    const commit = (await runProcess("git", ["-C", repository, "rev-parse", "HEAD"])).stdout.trim()
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: direct-git-skill
capabilities:
  loghelper:
    kind: skill
    identity: example/loghelper
    exposeAs: loghelper
    source:
      type: git
      url: ${JSON.stringify(repository)}
      revision:
        commit: ${JSON.stringify(commit)}
      path: skills/loghelper
    trust:
      instructions: trusted
`,
    )

    const previewOutput: string[] = []
    await createProgram({
      out: (value) => previewOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "sync", "--dry-run"], { from: "user" })
    const preview = JSON.parse(previewOutput.join("")) as {
      success: boolean
      data: { changePlan: { actions: Array<{ type: string; requiresAuthorization: boolean }> } }
    }
    expect(preview.success).toBe(true)
    expect(preview.data.changePlan.actions).toContainEqual(
      expect.objectContaining({ type: "acquire", requiresAuthorization: true }),
    )

    const refusedOutput: string[] = []
    await createProgram({
      out: (value) => refusedOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "sync"], { from: "user" })
    const refused = JSON.parse(refusedOutput.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(refused.success).toBe(false)
    expect(refused.diagnostics.some((item) => item.code === "ASTR5011")).toBe(true)
    expect(process.exitCode).toBe(4)

    const appliedOutput: string[] = []
    await createProgram({
      out: (value) => appliedOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "sync", "--yes"], { from: "user" })
    expect(JSON.parse(appliedOutput.join("")).success).toBe(true)
    expect(await readFile(join(root, ".agents", "skills", "loghelper", "SKILL.md"), "utf8")).toBe(
      "# Remote Skill\n",
    )

    await createProgram({ out: () => undefined, err: () => undefined }).parseAsync(
      ["--cwd", root, "lock"],
      { from: "user" },
    )
    const lock = parse(await readFile(join(root, "astrail.lock.yaml"), "utf8")) as {
      capabilities: {
        loghelper: {
          integrity: string
          source: { type: string; resolvedCommit: string; path: string }
        }
      }
    }
    expect(lock.capabilities.loghelper).toMatchObject({
      integrity: expect.stringMatching(/^sha256-/),
      source: { type: "git", resolvedCommit: commit, path: "skills/loghelper" },
    })
    const astrailEntries = await readFile(
      join(root, ".astrail", "projection-manifest.json"),
      "utf8",
    )
    expect(astrailEntries).not.toContain("cache")
  })

  it("previews and applies the same machine-readable Skill plan", async () => {
    const root = await cliWorkspace("astrail-cli-skill-json-")
    const inputPath = join(root, "skill.json")
    await writeFile(
      inputPath,
      JSON.stringify({
        identity: "example/loghelper",
        version: "1.2.0",
        source: {
          type: "git",
          url: "https://example.invalid/team-skills.git",
          revision: { tag: "v1.2.0" },
          path: "skills/loghelper",
        },
        trust: { instructions: "trusted" },
      }),
    )

    const previewOutput: string[] = []
    await createProgram({
      out: (value) => previewOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "skill", "add", "--input", inputPath, "--dry-run"], {
      from: "user",
    })
    const preview = JSON.parse(previewOutput.join("")) as {
      success: boolean
      data: { applied: boolean; plan: { planId: string; addition: { id: string } } }
    }
    expect(preview).toMatchObject({
      success: true,
      data: { applied: false, plan: { addition: { id: "loghelper" } } },
    })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).not.toContain("team-skills.git")

    const missingPlanOutput: string[] = []
    await createProgram({
      out: (value) => missingPlanOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "skill", "add", "--input", inputPath, "--yes"], {
      from: "user",
    })
    const missingPlan = JSON.parse(missingPlanOutput.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(missingPlan.success).toBe(false)
    expect(missingPlan.diagnostics.some((item) => item.code === "ASTR8021")).toBe(true)
    expect(process.exitCode).toBe(4)

    const mismatchOutput: string[] = []
    await createProgram({
      out: (value) => mismatchOutput.push(value),
      err: () => undefined,
    }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "skill",
        "add",
        "--input",
        inputPath,
        "--yes",
        "--plan-id",
        "different",
      ],
      { from: "user" },
    )
    const mismatch = JSON.parse(mismatchOutput.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(mismatch.success).toBe(false)
    expect(mismatch.diagnostics.some((item) => item.code === "ASTR7107")).toBe(true)

    const applyOutput: string[] = []
    await createProgram({
      out: (value) => applyOutput.push(value),
      err: () => undefined,
    }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "skill",
        "add",
        "--input",
        inputPath,
        "--yes",
        "--plan-id",
        preview.data.plan.planId,
      ],
      { from: "user" },
    )
    const applied = JSON.parse(applyOutput.join("")) as {
      success: boolean
      data: { applied: boolean; capability: { id: string } }
    }
    expect(applied).toMatchObject({
      success: true,
      data: { applied: true, capability: { id: "loghelper" } },
    })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toContain("team-skills.git")
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toContain("kind: skill")
    await expect(
      readFile(join(root, ".agents", "skills", "loghelper", "SKILL.md"), "utf8"),
    ).rejects.toThrow()
  })

  it("uses the interactive Skill adapter and preserves the reviewed core plan", async () => {
    const root = await cliWorkspace("astrail-cli-skill-interactive-")
    const request = {
      identity: "company/workspace-guide",
      source: { type: "workspace" as const, path: "skills/workspace-guide" },
    }
    const expected = await planSkillAddition(request, { cwd: root })
    let confirmations = 0
    const prompter: SkillPrompter = {
      async collect() {
        return request
      },
      async confirm(plan) {
        confirmations += 1
        expect(plan.planId).toBe(expected.planId)
        return true
      },
    }
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      { skillPrompter: prompter },
    ).parseAsync(["--cwd", root, "skill", "add"], { from: "user" })

    expect(confirmations).toBe(1)
    expect(output.join("")).toContain("Skill plan")
    expect(output.join("")).toContain("Added Skill workspace-guide")
    const config = parse(await readFile(join(root, "astrail.yaml"), "utf8")) as {
      capabilities: Record<string, unknown>
    }
    expect(config.capabilities["workspace-guide"]).toMatchObject({
      kind: "skill",
      identity: "company/workspace-guide",
      exposeAs: "workspace-guide",
      source: { type: "workspace", path: "skills/workspace-guide" },
    })
  })

  it("keeps Skill manifests unchanged on cancellation and never prompts in JSON mode", async () => {
    const root = await cliWorkspace("astrail-cli-skill-cancel-")
    const before = await readFile(join(root, "astrail.yaml"), "utf8")
    const prompter: SkillPrompter = {
      async collect() {
        return {
          identity: "company/cancelled",
          source: { type: "workspace", path: "skills/cancelled" },
        }
      },
      async confirm() {
        return false
      },
    }
    await createProgram(
      { out: () => undefined, err: () => undefined },
      { skillPrompter: prompter },
    ).parseAsync(["--cwd", root, "skill", "add"], { from: "user" })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)

    let prompted = false
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      {
        skillPrompter: {
          async collect() {
            prompted = true
            throw new Error("should not prompt")
          },
          async confirm() {
            prompted = true
            return true
          },
        },
      },
    ).parseAsync(["--json", "--cwd", root, "skill", "add"], { from: "user" })
    const envelope = JSON.parse(output.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(envelope.success).toBe(false)
    expect(envelope.diagnostics.some((item) => item.code === "ASTR8020")).toBe(true)
    expect(prompted).toBe(false)
  })

  it("previews and applies the same machine-readable repository plan", async () => {
    const root = await cliWorkspace("astrail-cli-repo-json-")
    const remote = await cliGitRepository(root, "platform.git")
    await mkdir(join(remote, "skills/guide"), { recursive: true })
    await writeFile(
      join(remote, "skills/guide/SKILL.md"),
      "---\nname: guide\ndescription: Platform guide\n---\n",
    )
    expect((await runProcess("git", ["-C", remote, "add", "."])).exitCode).toBe(0)
    expect(
      (
        await runProcess("git", [
          "-C",
          remote,
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.invalid",
          "commit",
          "-m",
          "skill",
        ])
      ).exitCode,
    ).toBe(0)
    const inputPath = join(root, "repository.json")
    await writeFile(
      inputPath,
      JSON.stringify({
        source: { type: "git", url: remote },
        description: "Shared platform services",
        role: "platform",
      }),
    )

    const previewOutput: string[] = []
    await createProgram({
      out: (value) => previewOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "repo", "add", "--input", inputPath, "--dry-run"], {
      from: "user",
    })
    const preview = JSON.parse(previewOutput.join("")) as {
      success: boolean
      data: {
        applied: boolean
        plan: {
          planId: string
          addition: { id: string; repository: { description?: string; role?: string } }
        }
      }
    }
    expect(preview).toMatchObject({
      success: true,
      data: {
        applied: false,
        plan: {
          addition: {
            id: "platform",
            repository: { description: "Shared platform services", role: "platform" },
          },
        },
      },
    })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).not.toContain("platform.git")

    const applyOutput: string[] = []
    await createProgram({
      out: (value) => applyOutput.push(value),
      err: () => undefined,
    }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "repo",
        "add",
        "--input",
        inputPath,
        "--yes",
        "--plan-id",
        preview.data.plan.planId,
      ],
      { from: "user" },
    )
    const applied = JSON.parse(applyOutput.join("")) as {
      success: boolean
      data: {
        applied: boolean
        repository: { id: string; description?: string; role?: string }
      }
    }
    expect(applied).toMatchObject({
      success: true,
      data: {
        applied: true,
        preparation: { status: "ready" },
        repositorySkills: { discovered: 1, unimported: 1 },
        repository: {
          id: "platform",
          description: "Shared platform services",
          role: "platform",
        },
      },
    })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toContain("platform.git")
    expect(await readFile(join(root, "repos/platform/skills/guide/SKILL.md"), "utf8")).toContain(
      "Platform guide",
    )
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).not.toContain("capabilities:")

    for (const command of [["repo", "list"], ["status"]]) {
      const inspectionOutput: string[] = []
      await createProgram({
        out: (value) => inspectionOutput.push(value),
        err: () => undefined,
      }).parseAsync(["--json", "--cwd", root, ...command], { from: "user" })
      const inspection = JSON.parse(inspectionOutput.join("")) as {
        data:
          | Array<{ description?: string; role?: string }>
          | {
              topology: { repositories: Array<{ description?: string; role?: string }> }
            }
      }
      const repositories = Array.isArray(inspection.data)
        ? inspection.data
        : inspection.data.topology.repositories
      expect(repositories[0]).toMatchObject({
        description: "Shared platform services",
        role: "platform",
      })
    }
    const humanInspection: string[] = []
    await createProgram({
      out: (value) => humanInspection.push(value),
      err: () => undefined,
    }).parseAsync(["--cwd", root, "repo", "list"], { from: "user" })
    expect(humanInspection.join("")).toContain("Shared platform services")
    expect(humanInspection.join("")).toContain("platform")
  })

  it("returns agent-readable repository Skill candidates immediately after local repo add", async () => {
    const root = await cliWorkspace("astrail-cli-repo-skills-json-")
    const repository = join(root, "existing-platform")
    await mkdir(join(repository, "skills", "workspace-guide"), { recursive: true })
    await writeFile(
      join(repository, "skills", "workspace-guide", "SKILL.md"),
      "---\nname: workspace-guide\ndescription: Workspace guide\n---\n",
    )
    const inputPath = join(root, "repository.json")
    await writeFile(
      inputPath,
      JSON.stringify({ id: "platform", source: { type: "local", path: repository } }),
    )

    const previewOutput: string[] = []
    await createProgram({
      out: (value) => previewOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "repo", "add", "--input", inputPath, "--dry-run"], {
      from: "user",
    })
    const preview = JSON.parse(previewOutput.join("")) as {
      data: { plan: { planId: string } }
    }

    const applyOutput: string[] = []
    await createProgram({
      out: (value) => applyOutput.push(value),
      err: () => undefined,
    }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "repo",
        "add",
        "--input",
        inputPath,
        "--yes",
        "--plan-id",
        preview.data.plan.planId,
      ],
      { from: "user" },
    )
    const applied = JSON.parse(applyOutput.join("")) as {
      success: boolean
      data: {
        repositorySkills: {
          discovered: number
          unimported: number
          importable: number
          candidates: Array<{ repository: string; path: string; proposedAlias: string }>
        }
        nextSteps: Array<{ operation: string; command: string }>
      }
      diagnostics: Array<{ code: string; severity: string }>
    }
    expect(applied.success).toBe(true)
    expect(applied.data.repositorySkills).toMatchObject({
      discovered: 1,
      unimported: 1,
      importable: 1,
      candidates: [
        {
          repository: "platform",
          path: "skills/workspace-guide",
          proposedAlias: "workspace-guide",
        },
      ],
    })
    expect(applied.data.nextSteps).toContainEqual(
      expect.objectContaining({
        operation: "skill-discover",
        command: "astrail --json skill discover --repository platform",
      }),
    )
    expect(applied.diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR8014", severity: "information" }),
    )
  })

  it("continues from interactive repo add into selective Skill import", async () => {
    const root = await cliWorkspace("astrail-cli-repo-import-skills-")
    const repository = join(root, "existing-service")
    await mkdir(join(repository, ".agents", "skills", "service-guide"), { recursive: true })
    await writeFile(
      join(repository, ".agents", "skills", "service-guide", "SKILL.md"),
      "---\nname: service-guide\ndescription: Service guide\n---\n",
    )
    const repositoryPrompter: RepositoryPrompter = {
      async collect() {
        return { id: "service", source: { type: "local", path: repository } }
      },
      async confirm() {
        return true
      },
    }
    let selectedCandidates = 0
    const skillImportPrompter: SkillImportPrompter = {
      async select(candidates) {
        selectedCandidates = candidates.length
        return {
          selections: [
            {
              repository: "service",
              path: ".agents/skills/service-guide",
              trust: { instructions: "trusted" },
            },
          ],
        }
      },
      async confirm() {
        return true
      },
    }
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      { repositoryPrompter, skillImportPrompter },
    ).parseAsync(["--cwd", root, "repo", "add"], { from: "user" })

    expect(selectedCandidates).toBe(1)
    expect(output.join("")).toContain("Discovered 1 unimported Skill")
    expect(output.join("")).toContain("Imported 1 Skill")
    const config = parse(await readFile(join(root, "astrail.yaml"), "utf8")) as {
      capabilities: Record<string, unknown>
    }
    expect(config.capabilities["service-guide"]).toMatchObject({
      kind: "skill",
      identity: "service/service-guide",
      exposeAs: "service-guide",
      source: {
        type: "repository",
        repository: "service",
        path: ".agents/skills/service-guide",
      },
      trust: { instructions: "trusted" },
    })
  })

  it("allows skipping the default Skill import without failing addition", async () => {
    const root = await cliWorkspace("astrail-cli-repo-skip-import-")
    const repository = join(root, "local")
    await mkdir(join(repository, "skills/guide"), { recursive: true })
    await writeFile(
      join(repository, "skills/guide/SKILL.md"),
      "---\nname: guide\ndescription: Guide\n---\n",
    )
    let offers = 0
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      {
        repositoryPrompter: {
          async collect() {
            return { id: "local", source: { type: "local", path: repository } }
          },
          async confirm() {
            return true
          },
        },
        skillImportPrompter: {
          async select(candidates, options) {
            expect(candidates).toHaveLength(1)
            expect(options?.allowSkip).toBe(true)
            offers += 1
            return { selections: [] }
          },
          async confirm() {
            throw new Error("Empty selection must not be confirmed")
          },
        },
      },
    ).parseAsync(["--cwd", root, "repo", "add"], { from: "user" })
    expect(offers).toBe(1)
    expect(output.join("")).toContain("Repository preparation completed")
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).not.toContain("capabilities:")
    expect(process.exitCode).not.toBe(1)
  })

  it("keeps declaration-only mode explicit and offers repo add retry without bootstrap", async () => {
    const root = await cliWorkspace("astrail-cli-repo-no-prepare-")
    const request = { id: "service", source: { type: "git", url: join(root, "remote") } }
    const input = join(root, "request.json")
    await writeFile(input, JSON.stringify(request))
    const preview: string[] = []
    await createProgram({ out: (value) => preview.push(value), err: () => undefined }).parseAsync(
      ["--json", "--cwd", root, "repo", "add", "--input", input, "--no-prepare", "--dry-run"],
      { from: "user" },
    )
    const plan = JSON.parse(preview.join("")).data.plan
    expect(plan.actions.map((action: { type: string }) => action.type)).toEqual(["write"])
    const output: string[] = []
    await createProgram({ out: (value) => output.push(value), err: () => undefined }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "repo",
        "add",
        "--input",
        input,
        "--no-prepare",
        "--yes",
        "--plan-id",
        plan.planId,
      ],
      { from: "user" },
    )
    const applied = JSON.parse(output.join(""))
    expect(applied).toMatchObject({
      success: true,
      data: { applied: true, preparation: { status: "skipped" } },
    })
    expect(applied.data.repositorySkills.unavailableRepositories).toEqual(["service"])
    expect(
      applied.data.nextSteps.some((step: { operation: string }) => step.operation === "bootstrap"),
    ).toBe(false)
    expect(
      applied.data.nextSteps.some(
        (step: { operation: string }) => step.operation === "repository-add",
      ),
    ).toBe(true)
    await expect(readFile(join(root, "repos/service/README.md"))).rejects.toThrow()
  })

  it("reports clone failure as partial completion and retries via repo add", async () => {
    const root = await cliWorkspace("astrail-cli-repo-retry-")
    const input = join(root, "request.json")
    await writeFile(
      input,
      JSON.stringify({ id: "service", source: { type: "git", url: join(root, "remote") } }),
    )
    const run = async (args: string[]) => {
      const output: string[] = []
      await createProgram(
        { out: (value) => output.push(value), err: () => undefined },
        {
          skillImportPrompter: {
            async select() {
              throw new Error("Machine mode must not prompt")
            },
            async confirm() {
              throw new Error("Machine mode must not prompt")
            },
          },
        },
      ).parseAsync(["--json", "--cwd", root, "repo", "add", "--input", input, ...args], {
        from: "user",
      })
      return JSON.parse(output.join(""))
    }
    const preview = await run(["--dry-run"])
    const failed = await run(["--yes", "--plan-id", preview.data.plan.planId])
    expect(failed).toMatchObject({
      success: false,
      data: { applied: true, preparation: { status: "failed" } },
    })
    expect(failed.data.repositorySkills).toBeUndefined()
    expect(failed.data.nextSteps[0].operation).toBe("repository-add")
    await cliGitRepository(root, "remote")
    const retry = await run(["--dry-run"])
    expect(retry.data.plan.registration).toBe("reuse")
    expect(retry.data.plan.files).toEqual([])
    const ready = await run(["--yes", "--plan-id", retry.data.plan.planId])
    expect(ready).toMatchObject({
      success: true,
      data: { applied: true, preparation: { status: "ready" } },
    })
  })

  it("refuses a machine apply without a reviewed plan ID and never prompts", async () => {
    const root = await cliWorkspace("astrail-cli-repo-refuse-")
    const inputPath = join(root, "repository.json")
    await writeFile(
      inputPath,
      JSON.stringify({
        id: "reference",
        prepare: false,
        source: { type: "local", path: "references/foundation" },
      }),
    )
    let prompted = false
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      {
        repositoryPrompter: {
          async collect() {
            prompted = true
            throw new Error("should not prompt")
          },
          async confirm() {
            prompted = true
            return true
          },
        },
      },
    ).parseAsync(["--json", "--cwd", root, "repo", "add", "--input", inputPath, "--yes"], {
      from: "user",
    })
    const envelope = JSON.parse(output.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(envelope.success).toBe(false)
    expect(envelope.diagnostics.some((item) => item.code === "ASTR8011")).toBe(true)
    expect(prompted).toBe(false)
    expect(process.exitCode).toBe(4)

    const chainedOutput: string[] = []
    await createProgram(
      { out: (value) => chainedOutput.push(value), err: () => undefined },
      {
        repositoryPrompter: {
          async collect() {
            prompted = true
            throw new Error("should not prompt")
          },
          async confirm() {
            prompted = true
            return true
          },
        },
      },
    ).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "repo",
        "add",
        "--input",
        inputPath,
        "--import-skills",
        "--dry-run",
      ],
      { from: "user" },
    )
    const chained = JSON.parse(chainedOutput.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(chained.success).toBe(false)
    expect(chained.diagnostics.some((item) => item.code === "ASTR8013")).toBe(true)
    expect(prompted).toBe(false)
  })

  it("returns structured diagnostics for incomplete machine input", async () => {
    const root = await cliWorkspace("astrail-cli-repo-invalid-")
    const inputPath = join(root, "repository.json")
    await writeFile(inputPath, JSON.stringify({ id: "incomplete" }))
    const output: string[] = []
    await createProgram({ out: (value) => output.push(value), err: () => undefined }).parseAsync(
      ["--json", "--cwd", root, "repo", "add", "--input", inputPath, "--dry-run"],
      { from: "user" },
    )
    const envelope = JSON.parse(output.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(envelope.success).toBe(false)
    expect(envelope.diagnostics.some((item) => item.code === "ASTR7001")).toBe(true)
  })

  it("uses the interactive adapter and preserves core defaults", async () => {
    const root = await cliWorkspace("astrail-cli-repo-interactive-")
    await mkdir(join(root, "references/protocol"), { recursive: true })
    let confirmations = 0
    const prompter: RepositoryPrompter = {
      async collect() {
        return {
          source: { type: "local", path: "references/protocol" },
          description: "Contract and protocol reference",
          role: "contracts",
          writeTarget: "auto",
        }
      },
      async confirm(plan) {
        confirmations += 1
        expect(plan.addition).toMatchObject({
          id: "protocol",
          selectedTarget: "shared",
          repository: {
            access: "read-only",
            required: true,
            description: "Contract and protocol reference",
            role: "contracts",
          },
        })
        return true
      },
    }
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      { repositoryPrompter: prompter },
    ).parseAsync(["--cwd", root, "repo", "add"], { from: "user" })

    expect(confirmations).toBe(1)
    expect(output.join("")).toContain("Repository plan")
    expect(output.join("")).toContain("Contract and protocol reference")
    expect(output.join("")).toContain("contracts")
    expect(output.join("")).toContain("Added repository protocol")
    expect(output.join("")).toContain("Environment configuration is optional")
    const config = parse(await readFile(join(root, "astrail.yaml"), "utf8")) as {
      repositories: Record<string, unknown>
    }
    expect(config.repositories.protocol).toMatchObject({
      required: true,
      access: "read-only",
      description: "Contract and protocol reference",
      role: "contracts",
      source: { type: "local", path: "references/protocol" },
    })
  })

  it("leaves manifests unchanged when the interactive plan is cancelled", async () => {
    const root = await cliWorkspace("astrail-cli-repo-cancel-")
    const before = await readFile(join(root, "astrail.yaml"), "utf8")
    const prompter: RepositoryPrompter = {
      async collect() {
        return {
          id: "cancelled",
          source: { type: "git", url: "https://example.invalid/cancelled.git" },
        }
      },
      async confirm() {
        return false
      },
    }
    await createProgram(
      { out: () => undefined, err: () => undefined },
      { repositoryPrompter: prompter },
    ).parseAsync(["--cwd", root, "repo", "add"], { from: "user" })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)
  })

  it.each([
    { branch: "feature/a" },
    { branch: "main", branches: { backend: "feature/a" } },
    { branches: { frontend: "main", backend: "feature/a" } },
  ])("previews and applies the same machine-readable environment plan: %j", async (checkout) => {
    const root = await environmentWorkspace("astrail-cli-environment-json-")
    const inputPath = join(root, "environment.json")
    await writeFile(
      inputPath,
      JSON.stringify({
        id: "feature-a",
        repositories: ["frontend", "backend"],
        ...checkout,
        resources: { endpoint: "https://feature-a.example.invalid" },
      }),
    )

    const previewOutput: string[] = []
    await createProgram({
      out: (value) => previewOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "env", "add", "--input", inputPath, "--dry-run"], {
      from: "user",
    })
    const preview = JSON.parse(previewOutput.join("")) as {
      success: boolean
      data: { applied: boolean; plan: { planId: string; addition: { id: string } } }
    }
    expect(preview).toMatchObject({
      success: true,
      data: { applied: false, plan: { addition: { id: "feature-a" } } },
    })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).not.toContain("feature-a:")

    const missingPlanOutput: string[] = []
    await createProgram({
      out: (value) => missingPlanOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "env", "add", "--input", inputPath, "--yes"], {
      from: "user",
    })
    const missingPlan = JSON.parse(missingPlanOutput.join("")) as {
      success: boolean
      diagnostics: Array<{ code: string }>
    }
    expect(missingPlan.success).toBe(false)
    expect(missingPlan.diagnostics.some((item) => item.code === "ASTR8031")).toBe(true)

    const applyOutput: string[] = []
    await createProgram({
      out: (value) => applyOutput.push(value),
      err: () => undefined,
    }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "env",
        "add",
        "--input",
        inputPath,
        "--yes",
        "--plan-id",
        preview.data.plan.planId,
      ],
      { from: "user" },
    )
    const applied = JSON.parse(applyOutput.join("")) as {
      success: boolean
      data: { applied: boolean; environment: { id: string } }
    }
    expect(applied).toMatchObject({
      success: true,
      data: { applied: true, environment: { id: "feature-a" } },
    })
    expect(parse(await readFile(join(root, "astrail.yaml"), "utf8"))).toMatchObject({
      environments: {
        "feature-a": {
          repositories: ["backend", "frontend"],
          checkout,
        },
      },
    })
  })

  it("uses the interactive environment adapter and leaves cancellation unchanged", async () => {
    const root = await environmentWorkspace("astrail-cli-environment-interactive-")
    const request = {
      id: "feature-a",
      repositories: ["frontend", "backend"],
      branch: "feature/a",
    }
    const expected = await planEnvironmentAddition(request, { cwd: root })
    let confirmations = 0
    const prompter: EnvironmentPrompter = {
      async collect() {
        return request
      },
      async confirm(plan) {
        confirmations += 1
        expect(plan.planId).toBe(expected.planId)
        return true
      },
    }
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      { environmentPrompter: prompter },
    ).parseAsync(["--cwd", root, "env", "add"], { from: "user" })
    expect(confirmations).toBe(1)
    expect(output.join("")).toContain("Environment plan")
    expect(output.join("")).toContain("Added environment feature-a")

    const cancelRoot = await environmentWorkspace("astrail-cli-environment-cancel-")
    const before = await readFile(join(cancelRoot, "astrail.yaml"), "utf8")
    await createProgram(
      { out: () => undefined, err: () => undefined },
      {
        environmentPrompter: {
          async collect() {
            return request
          },
          async confirm() {
            return false
          },
        },
      },
    ).parseAsync(["--cwd", cancelRoot, "env", "add"], { from: "user" })
    expect(await readFile(join(cancelRoot, "astrail.yaml"), "utf8")).toBe(before)

    let prompted = false
    const jsonOutput: string[] = []
    await createProgram(
      { out: (value) => jsonOutput.push(value), err: () => undefined },
      {
        environmentPrompter: {
          async collect() {
            prompted = true
            return request
          },
          async confirm() {
            prompted = true
            return true
          },
        },
      },
    ).parseAsync(["--json", "--cwd", cancelRoot, "env", "add"], { from: "user" })
    expect(prompted).toBe(false)
    expect(JSON.parse(jsonOutput.join("")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR8030" }),
    )
  })

  it.each([
    { branch: "feature/a" },
    { branch: "feature/a", branches: { backend: "main" } },
    { branches: { frontend: "feature/a", backend: "main" } },
  ])("previews, authorizes, and reports environment checkout: %j", async (checkout) => {
    const root = await mkdtemp(join(tmpdir(), "astrail-cli-environment-checkout-"))
    const frontend = await cliGitRepository(root, "frontend")
    const backend = await cliGitRepository(root, "backend")
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: environment-checkout
repositories:
  frontend:
    access: read-write
    source: { type: local, path: ${JSON.stringify(frontend)} }
  backend:
    access: read-write
    source: { type: local, path: ${JSON.stringify(backend)} }
environments:
  feature-a:
    repositories: [frontend, backend]
    checkout: ${JSON.stringify(checkout)}
`,
    )

    const previewOutput: string[] = []
    await createProgram({
      out: (value) => previewOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "env", "checkout", "feature-a", "--dry-run"], {
      from: "user",
    })
    const preview = JSON.parse(previewOutput.join("")) as {
      success: boolean
      data: { plan: { planId: string; actions: unknown[] } }
    }
    expect(preview.success).toBe(true)
    expect(preview.data.plan.actions).toHaveLength(2)

    const missingPlanOutput: string[] = []
    await createProgram({
      out: (value) => missingPlanOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "env", "checkout", "feature-a", "--yes"], {
      from: "user",
    })
    expect(JSON.parse(missingPlanOutput.join("")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR8033" }),
    )

    const applyOutput: string[] = []
    await createProgram({
      out: (value) => applyOutput.push(value),
      err: () => undefined,
    }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "env",
        "checkout",
        "feature-a",
        "--yes",
        "--plan-id",
        preview.data.plan.planId,
      ],
      { from: "user" },
    )
    expect(JSON.parse(applyOutput.join(""))).toMatchObject({
      success: true,
      data: { applied: true, status: { consistent: true } },
    })

    const statusOutput: string[] = []
    await createProgram({
      out: (value) => statusOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "env", "status", "feature-a"], { from: "user" })
    expect(JSON.parse(statusOutput.join(""))).toMatchObject({
      success: true,
      data: { consistent: true },
    })
    const expectedBranches = checkout.branches ?? { frontend: "feature/a", backend: "feature/a" }
    expect(JSON.parse(statusOutput.join("")).data.repositories).toEqual([
      expect.objectContaining({
        repository: "backend",
        desiredBranch: expectedBranches.backend,
        currentBranch: expectedBranches.backend,
      }),
      expect.objectContaining({
        repository: "frontend",
        desiredBranch: "feature/a",
        currentBranch: "feature/a",
      }),
    ])
    const humanOutput: string[] = []
    await createProgram({
      out: (value) => humanOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--cwd", root, "env", "status", "feature-a"], { from: "user" })
    expect(humanOutput.join("")).toContain("desiredBranch")
    expect(humanOutput.join("")).toContain(expectedBranches.backend)
    expect(humanOutput.join("")).not.toContain("undefined")
  })

  it("discovers repository Skills in scoped and all JSON modes without prompting", async () => {
    const root = await skillRepositoryWorkspace("astrail-cli-skill-discover-")
    const scopedOutput: string[] = []
    await createProgram({
      out: (value) => scopedOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "skill", "discover", "--repository", "platform"], {
      from: "user",
    })
    const scoped = JSON.parse(scopedOutput.join("")) as {
      success: boolean
      data: { candidates: Array<{ key: string }> }
    }
    expect(scoped.success).toBe(true)
    expect(scoped.data.candidates.map((candidate) => candidate.key)).toEqual([
      "platform:skills/api",
      "platform:skills/logs",
    ])

    const allOutput: string[] = []
    await createProgram({
      out: (value) => allOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "skill", "discover", "--all"], {
      from: "user",
    })
    const all = JSON.parse(allOutput.join("")) as {
      data: { candidates: unknown[] }
      diagnostics: Array<{ code: string }>
    }
    expect(all.data.candidates).toHaveLength(2)
    expect(all.diagnostics).toContainEqual(expect.objectContaining({ code: "ASTR7202" }))

    const unknownOutput: string[] = []
    await createProgram({
      out: (value) => unknownOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "skill", "discover", "--repository", "missing"], {
      from: "user",
    })
    expect(JSON.parse(unknownOutput.join("")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR7201" }),
    )

    let prompted = false
    const nonInteractiveOutput: string[] = []
    await createProgram(
      { out: (value) => nonInteractiveOutput.push(value), err: () => undefined },
      {
        skillImportPrompter: {
          async select() {
            prompted = true
            return { selections: [] }
          },
          async confirm() {
            prompted = true
            return true
          },
        },
      },
    ).parseAsync(["--json", "--cwd", root, "skill", "import", "--all"], {
      from: "user",
    })
    expect(prompted).toBe(false)
    expect(JSON.parse(nonInteractiveOutput.join("")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR8023" }),
    )
  })

  it("resolves repository-backed Capabilities through subpath repository roots", async () => {
    const root = await skillRepositoryWorkspace("astrail-cli-capability-path-")
    const manifestPath = join(root, "astrail.yaml")
    const manifest = await readFile(manifestPath, "utf8")
    await writeFile(
      manifestPath,
      `${manifest.replace(
        "  unavailable:\n",
        "  skill-root:\n    access: read-write\n    source: { type: subpath, repository: platform, path: skills }\n  unavailable:\n",
      )}capabilities:
  api-tools:
    kind: skill
    identity: platform/api
    exposeAs: api-tools
    source: { type: repository, repository: skill-root, path: api }
    trust: { instructions: trusted }
`,
    )

    for (const args of [
      ["capability", "list"],
      ["capability", "resolve", "api-tools"],
    ]) {
      const output: string[] = []
      await createProgram({
        out: (value) => output.push(value),
        err: () => undefined,
      }).parseAsync(["--json", "--cwd", root, ...args], { from: "user" })
      const envelope = JSON.parse(output.join("")) as {
        success: boolean
        data: { capabilities: Array<{ path?: string }> }
      }
      expect(envelope.success).toBe(true)
      expect(envelope.data.capabilities[0]?.path).toBe(join(root, "platform", "skills", "api"))
    }
  })

  it("previews and applies a selective machine Skill import without projection", async () => {
    const root = await skillRepositoryWorkspace("astrail-cli-skill-import-")
    const request = {
      selections: [
        {
          repository: "platform",
          path: "skills/logs",
          identity: "company/logs",
          exposeAs: "workspace-logs",
        },
      ],
    }
    const inputPath = join(root, "selection.json")
    await writeFile(inputPath, JSON.stringify(request))

    const previewOutput: string[] = []
    await createProgram({
      out: (value) => previewOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "skill", "import", "--input", inputPath, "--dry-run"], {
      from: "user",
    })
    const preview = JSON.parse(previewOutput.join("")) as {
      success: boolean
      data: { plan: { planId: string; additions: Array<{ id: string }> } }
    }
    expect(preview).toMatchObject({
      success: true,
      data: { plan: { additions: [{ id: "logs" }] } },
    })

    const missingPlanOutput: string[] = []
    await createProgram({
      out: (value) => missingPlanOutput.push(value),
      err: () => undefined,
    }).parseAsync(["--json", "--cwd", root, "skill", "import", "--input", inputPath, "--yes"], {
      from: "user",
    })
    expect(JSON.parse(missingPlanOutput.join("")).diagnostics).toContainEqual(
      expect.objectContaining({ code: "ASTR8024" }),
    )

    const applyOutput: string[] = []
    await createProgram({
      out: (value) => applyOutput.push(value),
      err: () => undefined,
    }).parseAsync(
      [
        "--json",
        "--cwd",
        root,
        "skill",
        "import",
        "--input",
        inputPath,
        "--yes",
        "--plan-id",
        preview.data.plan.planId,
      ],
      { from: "user" },
    )
    expect(JSON.parse(applyOutput.join(""))).toMatchObject({
      success: true,
      data: { applied: true, capabilities: [{ id: "logs" }] },
    })
    const config = await readFile(join(root, "astrail.yaml"), "utf8")
    expect(config).toContain("workspace-logs")
    expect(config).not.toContain("company/api")
    await expect(
      readFile(join(root, ".agents", "skills", "workspace-logs", "SKILL.md"), "utf8"),
    ).rejects.toThrow()
  })

  it("uses the interactive Skill import adapter for an explicit subset", async () => {
    const root = await skillRepositoryWorkspace("astrail-cli-skill-import-interactive-")
    const request = {
      selections: [{ repository: "platform", path: "skills/api", exposeAs: "platform-api" }],
    }
    const expected = await planSkillImport(request, { cwd: root })
    let selections = 0
    let confirmations = 0
    const prompter: SkillImportPrompter = {
      async select(candidates) {
        selections += 1
        expect(candidates).toHaveLength(2)
        return request
      },
      async confirm(plan) {
        confirmations += 1
        expect(plan.planId).toBe(expected.planId)
        return true
      },
    }
    const output: string[] = []
    await createProgram(
      { out: (value) => output.push(value), err: () => undefined },
      { skillImportPrompter: prompter },
    ).parseAsync(["--cwd", root, "skill", "import", "--repository", "platform"], {
      from: "user",
    })
    expect(selections).toBe(1)
    expect(confirmations).toBe(1)
    expect(output.join("")).toContain("Skill import plan")
    expect(output.join("")).toContain("Imported 1 Skill")
  })
})

async function cliWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(
    join(root, "astrail.yaml"),
    `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: cli-authoring
`,
  )
  return root
}

async function environmentWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  await writeFile(
    join(root, "astrail.yaml"),
    `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: cli-environment
repositories:
  frontend:
    access: read-write
    source: { type: git, url: https://example.invalid/frontend.git }
  backend:
    access: read-write
    source: { type: git, url: https://example.invalid/backend.git }
`,
  )
  return root
}

async function skillRepositoryWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const platform = join(root, "platform")
  for (const [name, description] of [
    ["api", "API helper"],
    ["logs", "Log helper"],
  ] as const) {
    const directory = join(platform, "skills", name)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    )
  }
  await writeFile(
    join(root, "astrail.yaml"),
    `apiVersion: astrail.dev/v1alpha1
kind: Workspace
metadata:
  name: cli-skill-discovery
repositories:
  platform:
    access: read-write
    source: { type: local, path: ${JSON.stringify(platform)} }
  unavailable:
    required: false
    access: read-only
    source: { type: local, path: ${JSON.stringify(join(root, "unavailable"))} }
`,
  )
  return root
}

async function cliGitRepository(root: string, name: string): Promise<string> {
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
  expect((await runProcess("git", ["-C", repository, "branch", "feature/a"])).exitCode).toBe(0)
  return repository
}
