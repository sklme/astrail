import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { stringify } from "yaml"
import { applyEnvironmentCheckout, planEnvironmentCheckout } from "./environment-checkout.js"
import { atomicWrite, pathExists } from "./fs.js"
import { listJournal, parseJournalSince, showJournal, withWorkspaceJournal } from "./journal.js"
import { journalBeforeMutation, journalChange, journalTargets } from "./journal-trace.js"
import { loadWorkspace } from "./manifest.js"
import { runProcess } from "./process.js"
import { diagnostic, result } from "./types.js"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(settings?: object): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "astrail-journal-"))
  roots.push(root)
  await writeFile(
    join(root, "astrail.yaml"),
    stringify({
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "journal-test" },
    }),
  )
  if (settings)
    await writeFile(
      join(root, "astrail.local.yaml"),
      stringify({ apiVersion: "astrail.dev/v1alpha1", kind: "WorkspaceLocal", journal: settings }),
    )
  return root
}
const scoped = <T>(root: string, operation: () => Promise<ReturnType<typeof result<T>>>) =>
  withWorkspaceJournal({ root, command: "test.write", version: "0.4.0" }, operation)
const journalFile = (root: string) => join(root, ".astrail", "journal.jsonl")
async function change(root: string, content: string) {
  return scoped(root, async () => {
    await atomicWrite(join(root, "state.txt"), content)
    return result({ changed: true })
  })
}

describe("workspace journal", () => {
  it("records completed facts, timestamps and targets while excluding contents and diagnostic text", async () => {
    const root = await workspace()
    const secret = "secret-value-do-not-store"
    const outcome = await scoped(root, async () => {
      journalTargets({ repositories: ["api"], environments: ["feature"], planId: "reviewed" })
      await atomicWrite(join(root, "state.txt"), secret)
      return result({ output: secret }, [diagnostic("ASTR9999", "information", secret)])
    })
    expect(outcome.success).toBe(true)
    const text = await readFile(journalFile(root), "utf8")
    expect(text).not.toContain(secret)
    expect(text.trim().split("\n")).toHaveLength(2)
    const listed = await listJournal(root, { repo: "api", environment: "feature" })
    expect(listed.data.operations).toHaveLength(1)
    const operation = listed.data.operations[0]
    expect(operation).toMatchObject({
      status: "success",
      command: "test.write",
      planId: "reviewed",
      diagnosticCodes: ["ASTR9999"],
      changes: [{ kind: "file", target: "state.txt", action: "create", before: null }],
    })
    expect((await showJournal(root, operation?.operationId ?? "")).data.operation).toEqual(
      operation,
    )
    expect((await listJournal(root, { repo: "other" })).data.operations).toEqual([])
    expect((await showJournal(root, "missing")).diagnostics[0]?.code).toBe("ASTR7507")
  })

  it("keeps reads, successful no-ops and disabled recording free of filesystem writes", async () => {
    const root = await workspace()
    await listJournal(root)
    await showJournal(root, "missing")
    await scoped(root, async () => result(null))
    expect(await pathExists(join(root, ".astrail"))).toBe(false)
    await change(root, "same")
    const before = await readFile(journalFile(root), "utf8")
    await change(root, "same")
    await listJournal(root)
    expect(await readFile(journalFile(root), "utf8")).toBe(before)
    const disabled = await workspace({ enabled: false })
    await change(disabled, "new state")
    expect(await pathExists(join(disabled, ".astrail"))).toBe(false)
    expect(await readFile(join(disabled, "state.txt"), "utf8")).toBe("new state")
  })

  it("enforces both retention limits, reports omitted details, and validates filters", async () => {
    const root = await workspace({ maxLines: 4, maxBytes: 4096 })
    for (let index = 0; index < 6; index++) await change(root, String(index))
    let text = await readFile(journalFile(root), "utf8")
    expect(text.trim().split("\n")).toHaveLength(4)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096)
    expect((await listJournal(root)).data.operations).toHaveLength(2)
    await scoped(root, async () => {
      await journalBeforeMutation()
      for (let index = 0; index < 600; index++)
        journalChange({
          kind: "file",
          target: `file-${index}`,
          action: "write",
          after: { digest: "a".repeat(64) },
        })
      return result(null)
    })
    text = await readFile(journalFile(root), "utf8")
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(4096)
    const operation = (await listJournal(root, { limit: 1 })).data.operations[0]
    expect(operation?.status).toBe("success")
    expect(operation?.omittedChanges).toBeGreaterThan(0)
    expect((operation?.changes?.length ?? 0) + (operation?.omittedChanges ?? 0)).toBe(600)
    expect((await listJournal(root, { since: "2999-01-01" })).data.operations).toEqual([])
    for (const query of [
      { limit: 0 },
      { limit: Number.NaN },
      { since: "2026-02-30" },
      { since: "yesterday" },
      { since: "2026-09-23T01:00:00" },
    ])
      expect((await listJournal(root, query)).success).toBe(false)
    expect(parseJournalSince("2026-09-23T09:00:00+08:00")).toBe(Date.parse("2026-09-23T01:00:00Z"))
    expect(parseJournalSince("2026-09-23")).toBe(Date.parse("2026-09-23T00:00:00Z"))
  })

  it("does not change effective configuration or plan fingerprints for local journal settings", async () => {
    const root = await workspace()
    const before = await loadWorkspace({ cwd: root })
    await writeFile(
      join(root, "astrail.local.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "WorkspaceLocal",
        journal: { enabled: false, maxLines: 10 },
      }),
    )
    const after = await loadWorkspace({ cwd: root })
    expect(after.effective).toEqual(before.effective)
    expect(after.diagnostics.filter((item) => item.severity === "error")).toEqual([])
  })

  it("preserves operation success and existing history when storage is damaged or unsafe", async () => {
    const root = await workspace()
    await change(root, "first")
    await appendFile(journalFile(root), '{"broken":\n')
    const original = await readFile(journalFile(root), "utf8")
    const changed = await change(root, "second")
    expect(changed.success).toBe(true)
    expect(changed.diagnostics.map((item) => item.code)).toContain("ASTR7502")
    expect(await readFile(journalFile(root), "utf8")).toBe(original)
    const listed = await listJournal(root)
    expect(listed.success).toBe(true)
    expect(listed.data.operations).toHaveLength(1)
    expect(listed.diagnostics[0]?.code).toBe("ASTR7506")
    const unsafe = await workspace()
    const outside = join(root, "outside.txt")
    await writeFile(outside, "keep")
    await mkdir(join(unsafe, ".astrail"))
    await symlink(outside, journalFile(unsafe))
    expect((await change(unsafe, "actual operation")).success).toBe(true)
    expect(await readFile(outside, "utf8")).toBe("keep")
    expect((await listJournal(unsafe)).success).toBe(false)
    expect(await pathExists(join(unsafe, ".astrail", "journal.lock"))).toBe(false)
  })

  it("distinguishes failed preflight, partial execution and restored writes, without retaining error secrets", async () => {
    const root = await workspace()
    await scoped(root, async () =>
      result(null, [diagnostic("ASTR7007", "error", "password=private")]),
    )
    expect((await listJournal(root, { limit: 1 })).data.operations[0]?.status).toBe("failed")
    await expect(
      scoped(root, async () => {
        await atomicWrite(join(root, "state.txt"), "before")
        throw new Error("password=private")
      }),
    ).rejects.toThrow("password=private")
    expect((await listJournal(root, { limit: 1 })).data.operations[0]?.status).toBe("partial")
    await scoped(root, async () => {
      await atomicWrite(join(root, "state.txt"), "temporary")
      await atomicWrite(join(root, "state.txt"), "before")
      return result(null, [diagnostic("ASTR7210", "error", "restored")])
    })
    expect((await listJournal(root, { limit: 1 })).data.operations[0]?.status).toBe("failed")
    expect(await readFile(journalFile(root), "utf8")).not.toContain("private")
  })

  it("records real partial environment checkout and leaves reviewed plans valid", async () => {
    const root = await workspace()
    const repositories: Record<string, object> = {}
    for (const id of ["api", "web"]) {
      const path = join(root, id)
      await mkdir(path)
      await git(path, "init", "-b", "main")
      await git(
        path,
        "-c",
        "user.name=Journal Test",
        "-c",
        "user.email=journal@example.invalid",
        "commit",
        "--allow-empty",
        "-m",
        "Initial",
      )
      await git(path, "branch", "feature")
      repositories[id] = { source: { type: "local", path: id }, access: "read-write" }
    }
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "journal" },
        repositories,
        environments: {
          feature: { repositories: ["api", "web"], checkout: { branch: "feature" } },
        },
      }),
    )
    const plan = await planEnvironmentCheckout("feature", { cwd: root })
    expect(plan.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    const applied = await withWorkspaceJournal(
      { root, command: "env.checkout", version: "0.4.0" },
      () =>
        applyEnvironmentCheckout(plan, {
          authorized: true,
          expectedPlanId: plan.planId,
          switchBranch: async (path, branch) =>
            path.endsWith("web")
              ? { exitCode: 1, stdout: "", stderr: "simulated token=private failure" }
              : runProcess("git", ["-C", path, "switch", branch]),
        }),
    )
    expect(applied.success).toBe(false)
    expect(applied.data.completedActions).toHaveLength(1)
    const operation = (await listJournal(root, { repo: "web", environment: "feature" })).data
      .operations[0]
    expect(operation).toMatchObject({
      status: "partial",
      planId: plan.planId,
      failedRepositories: ["web"],
      pendingRepositories: ["web"],
      changes: [
        {
          kind: "repository",
          target: "api",
          action: "checkout",
          before: { branch: "main" },
          after: { branch: "feature" },
        },
      ],
    })
    expect(operation?.changes?.[0]?.after?.revision).toMatch(/^[a-f0-9]{40}$/)
    expect(await readFile(journalFile(root), "utf8")).not.toContain("private")
  })

  it("records actual branch changes even when the switch executor throws afterward", async () => {
    const root = await workspace()
    const path = join(root, "api")
    await mkdir(path)
    await git(path, "init", "-b", "main")
    await git(
      path,
      "-c",
      "user.name=Journal Test",
      "-c",
      "user.email=journal@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    )
    await git(path, "branch", "feature")
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "journal" },
        repositories: { api: { source: { type: "local", path: "api" }, access: "read-write" } },
        environments: { feature: { repositories: ["api"], checkout: { branch: "feature" } } },
      }),
    )
    const plan = await planEnvironmentCheckout("feature", { cwd: root })
    await scoped(root, () =>
      applyEnvironmentCheckout(plan, {
        authorized: true,
        switchBranch: async (path, branch) => {
          await git(path, "switch", branch)
          throw new Error("executor interrupted")
        },
      }),
    )
    expect((await listJournal(root)).data.operations[0]).toMatchObject({
      status: "partial",
      failedRepositories: ["api"],
      changes: [
        {
          kind: "repository",
          target: "api",
          before: { branch: "main" },
          after: { branch: "feature" },
        },
      ],
    })
  })

  it("redacts unapproved snapshot fields, URLs, credentials and terminal controls", async () => {
    const root = await workspace()
    await scoped(root, async () => {
      await journalBeforeMutation()
      journalChange({
        kind: "skill",
        target: "ghp_1234567890abcdefghijklmnopqrst",
        action: "declare",
        after: {
          identity: "https://user:private@example.invalid/?token=private",
          password: "never-copy-me",
          version: "1.0.0\u001b\n",
        },
      })
      return result(null)
    })
    const raw = await readFile(journalFile(root), "utf8")
    for (const secret of ["never-copy-me", "user:private", "ghp_1234567890", "\\u001b", "password"])
      expect(raw).not.toContain(secret)
    expect(raw).toContain("[redacted-url]")
    expect(raw).toContain("[redacted]")
  })

  it("does not steal a busy journal lock or fail the mutation", async () => {
    const root = await workspace()
    await mkdir(join(root, ".astrail"))
    await writeFile(join(root, ".astrail", "journal.lock"), String(process.pid))
    const outcome = await change(root, "completed")
    expect(outcome.success).toBe(true)
    expect(outcome.diagnostics.map((item) => item.code)).toContain("ASTR7502")
    expect(await readFile(join(root, ".astrail", "journal.lock"), "utf8")).toBe(String(process.pid))
    expect(await readFile(join(root, "state.txt"), "utf8")).toBe("completed")
  })

  it("orders equal timestamps by event order and applies filters before the limit", async () => {
    const root = await workspace()
    await mkdir(join(root, ".astrail"))
    const common = {
      schemaVersion: "1",
      command: "fixture",
      astrailVersion: "0.4.0",
      timestamp: "2026-09-23T12:00:00.000Z",
      startedAt: "2026-09-23T12:00:00.000Z",
      phase: "finished",
      status: "success",
    }
    await writeFile(
      journalFile(root),
      [
        { ...common, operationId: "zzz", repositories: ["api"] },
        { ...common, operationId: "aaa", repositories: ["web"] },
      ]
        .map((event) => `${JSON.stringify(event)}\n`)
        .join(""),
    )
    expect((await listJournal(root, { limit: 1 })).data.operations[0]?.operationId).toBe("aaa")
    expect(
      (await listJournal(root, { repo: "api", limit: 1 })).data.operations[0]?.operationId,
    ).toBe("zzz")
  })

  it("merges concurrent processes without lost entries and leaves interrupted work unconfirmed", async () => {
    const root = await workspace()
    const moduleUrl = new URL("../dist/index.js", import.meta.url).href
    const children = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        runProcess(process.execPath, [
          "--input-type=module",
          "-e",
          `
      import { withWorkspaceJournal, atomicWrite, result } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(root)};
      await withWorkspaceJournal({root, command: 'child.${index}', version: '0.4.0'}, async () => {
        await atomicWrite(root + '/child-${index}.txt', 'done');
        return result(null);
      });
    `,
        ]),
      ),
    )
    for (const child of children) expect(child.exitCode, child.stderr).toBe(0)
    expect((await listJournal(root)).data.operations).toHaveLength(5)
    expect((await readFile(journalFile(root), "utf8")).trim().split("\n")).toHaveLength(10)
    const interrupted = await runProcess(process.execPath, [
      "--input-type=module",
      "-e",
      `
      import { withWorkspaceJournal, atomicWrite } from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(root)};
      await withWorkspaceJournal({root, command: 'interrupted', version: '0.4.0'}, async () => {
        await atomicWrite(root + '/interrupted.txt', 'done');
        process.exit(0);
      });
    `,
    ])
    expect(interrupted.exitCode, interrupted.stderr).toBe(0)
    expect((await listJournal(root, { limit: 1 })).data.operations[0]).toMatchObject({
      command: "interrupted",
      status: "unknown",
    })
    expect(
      (await readdir(join(root, ".astrail"))).some(
        (name) => name.endsWith(".tmp") || name === "journal.lock",
      ),
    ).toBe(false)
  })

  it("ignores local journal artifacts in Git and warns for an already tracked journal", async () => {
    const root = await workspace()
    await git(root, "init")
    await change(root, "first")
    const ignored = await runProcess("git", [
      "-C",
      root,
      "check-ignore",
      ".astrail/journal.jsonl",
      ".astrail/.gitignore",
      ".astrail/journal.lock",
      ".astrail/.journal-test.tmp",
    ])
    expect(ignored.stdout.trim().split("\n")).toHaveLength(4)
    await git(root, "add", "-f", ".astrail/journal.jsonl")
    const changed = await change(root, "second")
    expect(changed.success).toBe(true)
    expect(changed.diagnostics.map((item) => item.code)).toContain("ASTR7503")
  })
})

async function git(root: string, ...args: string[]) {
  const outcome = await runProcess("git", ["-C", root, ...args])
  expect(outcome.exitCode, outcome.stderr).toBe(0)
  return outcome
}
