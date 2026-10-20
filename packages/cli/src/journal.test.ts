import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type JournalListData,
  type JournalOperation,
  runProcess,
  type StructuredOutput,
} from "astrail-core"
import { afterEach, describe, expect, it } from "vitest"
import { stringify } from "yaml"
import { createProgram, type ProgramDependencies } from "./program.js"

const roots: string[] = []
const initialExitCode = process.exitCode
afterEach(async () => {
  process.exitCode = initialExitCode
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "astrail-cli-journal-"))
  roots.push(root)
  await writeFile(
    join(root, "astrail.yaml"),
    "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata:\n  name: journal\n",
  )
  return root
}

async function cli<T = unknown>(
  root: string,
  args: string[],
  dependencies: ProgramDependencies = {},
) {
  const stdout: string[] = []
  const stderr: string[] = []
  await createProgram(
    { out: (value) => stdout.push(value), err: (value) => stderr.push(value) },
    dependencies,
  ).parseAsync(["--json", "--cwd", root, ...args], { from: "user" })
  return {
    result: JSON.parse(stdout.join("")) as StructuredOutput<T>,
    stderr,
    exitCode: process.exitCode,
  }
}

describe("journal CLI", () => {
  it("explains a real bootstrap with named configs, diagnostic details and timed phases", async () => {
    const root = await workspace()
    const remote = await workspace()
    await writeFile(
      join(remote, "astrail.config.yaml"),
      stringify({ metadata: { name: "team-config" } }),
    )
    for (const args of [
      ["init", "-b", "main"],
      ["add", "astrail.config.yaml"],
      [
        "-c",
        "user.name=Journal Test",
        "-c",
        "user.email=journal@example.invalid",
        "commit",
        "-m",
        "config",
      ],
    ]) {
      const outcome = await runProcess("git", ["-C", remote, ...args])
      expect(outcome.exitCode, outcome.stderr).toBe(0)
    }
    await mkdir(join(root, "api", "skills", "example"), { recursive: true })
    await writeFile(
      join(root, "api", "skills", "example", "SKILL.md"),
      "---\nname: example\ndescription: Example\n---\nPrivate instructions\n",
    )
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "journal" },
        extends: [{ git: remote, ref: "main" }],
        repositories: { api: { source: { type: "local", path: "api" }, access: "read-write" } },
      }),
    )
    const applied = await cli(root, ["bootstrap", "--yes"])
    expect(applied.result.success, JSON.stringify(applied.result.diagnostics)).toBe(true)
    const operation = (await cli<JournalListData>(root, ["journal", "list"])).result.data
      .operations[0]
    expect(operation?.summary).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Acquired config team-config \([a-f0-9]{12}\)$/),
        "Created file journal.code-workspace",
      ]),
    )
    expect(operation?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "config.acquire",
          status: "success",
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({ name: "skill.discover", status: "success" }),
        expect.objectContaining({ name: "projection.sync", status: "success" }),
        expect.objectContaining({ name: "editor.sync", status: "success" }),
      ]),
    )
    expect(operation?.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ASTR6105",
        severity: "information",
        message: "Bootstrap discovered 1 repository Skill that is not imported.",
      }),
    )
    const human: string[] = []
    await createProgram({ out: (value) => human.push(value), err: () => {} }).parseAsync(
      ["--cwd", root, "journal", "show", operation?.operationId ?? ""],
      { from: "user" },
    )
    for (const expected of [
      "Acquired config team-config",
      "Steps",
      "config.acquire",
      "Duration:",
      "INFORMATION ASTR6105",
      "skill discover --all",
    ])
      expect(human.join("")).toContain(expected)
    expect(await readFile(join(root, ".astrail", "journal.jsonl"), "utf8")).not.toContain(
      "Private instructions",
    )
  })

  it("marks failed bootstrap preparation and blocked follow-up stages without claiming a sync", async () => {
    const root = await workspace()
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "journal" },
        extends: [{ git: "/nonexistent-astrail-journal-config" }],
      }),
    )
    const applied = await cli(root, ["bootstrap", "--yes"])
    expect(applied.result.success).toBe(false)
    const operation = (await cli<JournalListData>(root, ["journal", "list"])).result.data
      .operations[0]
    expect(operation?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "config.acquire",
          status: "failed",
          diagnosticCodes: ["ASTR6106"],
        }),
        expect.objectContaining({ name: "projection.sync", status: "skipped", reason: "blocked" }),
        expect.objectContaining({ name: "editor.sync", status: "skipped", reason: "blocked" }),
      ]),
    )
    expect(operation?.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ASTR6106",
        severity: "error",
        message: "Shared config acquisition failed.",
      }),
    )
    expect(operation?.changes).toEqual([])
  })

  it("keeps dry-runs, inspection and empty history queries read-only", async () => {
    const root = await workspace()
    const before = (await readdir(root)).sort()
    for (const args of [
      ["status"],
      ["doctor"],
      ["sync", "--dry-run"],
      ["bootstrap", "--dry-run"],
      ["editor", "sync", "--dry-run"],
      ["lock", "--dry-run"],
      ["journal", "list"],
    ]) {
      await cli(root, args)
      expect((await readdir(root)).sort(), args.join(" ")).toEqual(before)
    }
    const listed = await cli<JournalListData>(root, ["journal", "list"])
    expect(listed.result).toMatchObject({
      schemaVersion: "1",
      command: "journal list",
      success: true,
      data: { root, operations: [], incompleteHistory: true },
      meta: { workspaceRoot: root },
    })
  })

  it("groups repository declaration and editor synchronization under one queryable operation", async () => {
    const root = await workspace()
    await mkdir(join(root, "api"))
    await writeFile(
      join(root, "repository.json"),
      JSON.stringify({
        id: "api",
        source: { type: "local", path: "api" },
        prepare: false,
        description: "API repository",
      }),
    )
    const preview = await cli<{ plan: { planId: string } }>(root, [
      "repo",
      "add",
      "--input",
      "repository.json",
      "--dry-run",
    ])
    expect(preview.result.success).toBe(true)
    expect((await cli<JournalListData>(root, ["journal", "list"])).result.data.operations).toEqual(
      [],
    )
    const applied = await cli(root, [
      "repo",
      "add",
      "--input",
      "repository.json",
      "--yes",
      "--plan-id",
      preview.result.data.plan.planId,
    ])
    expect(applied.result.success).toBe(true)
    const listed = await cli<JournalListData>(root, [
      "journal",
      "list",
      "--repo",
      "api",
      "--limit",
      "20",
      "--since",
      "2020-01-01",
    ])
    expect(listed.result.data.operations).toHaveLength(1)
    const operation = listed.result.data.operations[0]
    expect(operation).toMatchObject({
      command: "repo.add",
      status: "success",
      repositories: ["api"],
      planId: preview.result.data.plan.planId,
    })
    expect(operation?.changes?.some((change) => change.target === "astrail.yaml")).toBe(true)
    expect(operation?.changes?.some((change) => change.target.endsWith(".code-workspace"))).toBe(
      true,
    )
    const detail = await cli<{ operation: JournalOperation }>(root, [
      "journal",
      "show",
      operation?.operationId ?? "",
    ])
    expect(detail.result.data.operation).toEqual(operation)
    expect(
      (await cli<JournalListData>(root, ["journal", "list", "--repo", "different"])).result.data
        .operations,
    ).toEqual([])
    const human: string[] = []
    await createProgram({ out: (value) => human.push(value), err: () => {} }).parseAsync(
      ["--cwd", root, "journal", "list"],
      { from: "user" },
    )
    expect(human.join("")).toContain(operation?.operationId)
    expect(human.join("")).toContain("repo.add")
    expect(human.join("")).toContain("success")
    const before = await readFile(join(root, ".astrail", "journal.jsonl"), "utf8")
    await cli(root, ["editor", "sync"])
    expect(await readFile(join(root, ".astrail", "journal.jsonl"), "utf8")).toBe(before)
  })

  it("records reviewed-plan refusal without claiming planned changes were applied", async () => {
    const root = await workspace()
    await mkdir(join(root, "api"))
    await writeFile(
      join(root, "astrail.yaml"),
      "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata:\n  name: journal\nrepositories:\n  api:\n    access: read-write\n    source:\n      type: local\n      path: api\n",
    )
    await writeFile(
      join(root, "environment.json"),
      JSON.stringify({
        id: "resources",
        repositories: ["api"],
        branch: "feature",
        resources: { endpoint: "https://private.invalid/?token=private" },
      }),
    )
    const refused = await cli(root, [
      "env",
      "add",
      "--input",
      "environment.json",
      "--yes",
      "--plan-id",
      "wrong-plan",
    ])
    expect(refused.exitCode).toBe(4)
    const listed = await cli<JournalListData>(root, [
      "journal",
      "list",
      "--environment",
      "resources",
    ])
    expect(listed.result.data.operations[0]).toMatchObject({
      command: "env.add",
      status: "failed",
      changes: [],
    })
    const raw = await readFile(join(root, ".astrail", "journal.jsonl"), "utf8")
    expect(raw).not.toContain("private")
    const missing = await cli(root, ["journal", "show", "does-not-exist"])
    expect(missing.exitCode).toBe(1)
    for (const args of [
      ["--limit", "-1"],
      ["--limit", "1.2"],
      ["--since", "invalid"],
      ["--limit", ""],
    ])
      expect((await cli(root, ["journal", "list", ...args])).result.success).toBe(false)
  })

  it("keeps the business exit code when journal storage is unavailable", async () => {
    const root = await workspace()
    const outside = join(root, "keep.txt")
    await writeFile(outside, "untouched")
    await mkdir(join(root, ".astrail"))
    await symlink(outside, join(root, ".astrail", "journal.jsonl"))
    const synced = await cli(root, ["editor", "sync"])
    expect(synced.exitCode).toBe(0)
    expect(synced.result.success).toBe(true)
    expect(synced.result.diagnostics.map((item) => item.code)).toContain("ASTR7502")
    expect(await readFile(outside, "utf8")).toBe("untouched")
    expect(await readFile(join(root, "journal.code-workspace"), "utf8")).toContain("folders")
  })

  it("records init installation failure as partial and does not store installer output", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-journal-init-"))
    roots.push(root)
    const initialized = await cli(root, ["init"], {
      packageManagerRunner: async (_command, args) =>
        args[0] === "--version"
          ? { exitCode: 0, stdout: "11.20.0", stderr: "" }
          : { exitCode: 1, stdout: "", stderr: "secret-installer-output" },
    })
    expect(initialized.result.success).toBe(false)
    const operation = (await cli<JournalListData>(root, ["journal", "list"])).result.data
      .operations[0]
    expect(operation).toMatchObject({
      command: "init",
      status: "partial",
      diagnosticCodes: ["ASTR8102"],
    })
    expect(operation?.changes?.some((change) => change.target === "package.json")).toBe(true)
    expect(await readFile(join(root, ".astrail", "journal.jsonl"), "utf8")).not.toContain(
      "secret-installer-output",
    )
  })

  it("records Skill, bootstrap and lock lifecycles while a plain editor launch stays quiet", async () => {
    const root = await workspace()
    await mkdir(join(root, "skills", "example"), { recursive: true })
    await writeFile(
      join(root, "skills", "example", "SKILL.md"),
      "---\nname: example\ndescription: Example workspace skill\n---\nPrivate skill instructions\n",
    )
    await writeFile(
      join(root, "skill.json"),
      JSON.stringify({
        id: "example",
        identity: "test/example",
        version: "1.0.0",
        source: { type: "workspace", path: "skills/example" },
        trust: { instructions: "trusted" },
      }),
    )
    const preview = await cli<{ plan: { planId: string } }>(root, [
      "skill",
      "add",
      "--input",
      "skill.json",
      "--dry-run",
    ])
    const added = await cli(root, [
      "skill",
      "add",
      "--input",
      "skill.json",
      "--yes",
      "--plan-id",
      preview.result.data.plan.planId,
    ])
    expect(added.result.success, JSON.stringify(added.result.diagnostics)).toBe(true)
    for (const args of [["bootstrap", "--yes"], ["lock"]]) {
      const applied = await cli(root, args)
      expect(applied.result.success, JSON.stringify(applied.result.diagnostics)).toBe(true)
    }
    const manifest = await readFile(join(root, "astrail.yaml"), "utf8")
    await writeFile(join(root, "astrail.yaml"), manifest.replace("1.0.0", "1.1.0"))
    for (const args of [["update"], ["update", "--restore"]]) {
      const applied = await cli(root, args)
      expect(applied.result.success, JSON.stringify(applied.result.diagnostics)).toBe(true)
    }
    const operations = (await cli<JournalListData>(root, ["journal", "list"])).result.data
      .operations
    expect(operations).toHaveLength(5)
    expect(operations.find((operation) => operation.command === "skill.add")?.skills).toEqual([
      "example",
    ])
    expect(
      operations
        .find((operation) => operation.command === "bootstrap")
        ?.changes?.some((change) => change.kind === "projection"),
    ).toBe(true)
    expect(operations.find((operation) => operation.command === "update")?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "lock",
          target: "capabilities/example",
          before: expect.objectContaining({ version: "1.0.0" }),
          after: expect.objectContaining({ version: "1.1.0" }),
        }),
      ]),
    )
    expect(operations.find((operation) => operation.command === "update.restore")?.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "lock",
          target: "capabilities/example",
          after: expect.objectContaining({ version: "1.0.0" }),
        }),
      ]),
    )
    const before = await readFile(join(root, ".astrail", "journal.jsonl"), "utf8")
    expect(before).not.toContain("Private skill instructions")
    await cli(root, ["open", "--editor", "vscode"], {
      editor: { isExecutable: async () => true, launch: async () => ({ exitCode: 0 }) },
    })
    expect(await readFile(join(root, ".astrail", "journal.jsonl"), "utf8")).toBe(before)
    const agents = await readFile(join(root, "AGENTS.md"), "utf8")
    expect(agents).toContain("journal list --limit 20")
    const skill = await readFile(
      join(root, ".agents", "skills", "astrail-inspection", "SKILL.md"),
      "utf8",
    )
    expect(skill).toContain("journal show <operation-id>")
  })
})
