import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { pathExists, resolveWorkspace } from "astrail-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { stringify } from "yaml"
import {
  type EditorDependencies,
  launchEditorProcess,
  openEditor,
  resolveEditorLaunch,
} from "./editor.js"
import { createProgram } from "./program.js"

const initialExitCode = process.exitCode
afterEach(() => {
  process.exitCode = initialExitCode
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "astrail-editor-cli-"))
  await mkdir(join(root, "code"))
  const config = {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "editor" },
    repositories: {
      web: { access: "read-write", source: { type: "local", path: "code" } },
    },
  }
  await writeFile(join(root, "astrail.yaml"), stringify(config))
  return { root, config }
}
async function run(root: string, args: string[], editor: EditorDependencies = {}) {
  const output: string[] = []
  await createProgram(
    { out: (text) => output.push(text), err: () => undefined },
    { editor },
  ).parseAsync(["--json", "--cwd", root, ...args], { from: "user" })
  return JSON.parse(output.join(""))
}

describe("editor CLI", () => {
  it.each(["vscode", "cursor", "codebuddy"])(
    "opens %s through a JSON noninteractive command with argument arrays",
    async (editor) => {
      const { root } = await fixture()
      const launch = vi.fn(async () => ({ exitCode: 0 }))
      const result = await run(root, ["open", "--editor", editor], {
        platform: "darwin",
        isExecutable: async () => true,
        launch,
      })
      expect(result).toMatchObject({
        schemaVersion: "1",
        command: "open",
        success: true,
        data: { synchronized: true, launch: { editor, status: "dispatched" } },
      })
      expect(launch).toHaveBeenCalledWith(
        expect.stringContaining(".app/Contents/Resources/app/bin/code"),
        editor === "cursor"
          ? ["--classic", join(root, "editor.code-workspace")]
          : [join(root, "editor.code-workspace")],
        root,
      )
      expect(result.data.launch.executable).not.toBe("codebuddy")
    },
  )

  it("uses default/local executable preferences and never launches during dry-run", async () => {
    const { root, config } = await fixture()
    await writeFile(
      join(root, "astrail.local.yaml"),
      stringify({
        apiVersion: config.apiVersion,
        kind: "WorkspaceLocal",
        editor: {
          default: "codebuddy",
          workspaceFile: "Team Project.code-workspace",
          executables: { codebuddy: "/Custom Apps/IDE launcher" },
        },
      }),
    )
    const launch = vi.fn(async () => ({ exitCode: 0 }))
    const dependencies = { isExecutable: async () => true, launch }
    const preview = await run(root, ["open", "--dry-run"], dependencies)
    expect(preview.data.launch).toMatchObject({
      editor: "codebuddy",
      executable: "/Custom Apps/IDE launcher",
      args: [join(root, "Team Project.code-workspace")],
      status: "planned",
    })
    expect(preview.data.synchronized).toBe(false)
    expect(launch).not.toHaveBeenCalled()
    expect(await pathExists(join(root, ".astrail"))).toBe(false)
    expect(await pathExists(preview.data.workspacePath)).toBe(false)
    expect((await run(root, ["open"], dependencies)).data.launch.status).toBe("dispatched")
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it("retains generated files on missing or failing launcher and returns stable diagnostics", async () => {
    const { root } = await fixture()
    const missing = await run(root, ["open"], { isExecutable: async () => false })
    expect(missing).toMatchObject({
      success: false,
      data: { synchronized: true, launch: { status: "failed" } },
    })
    expect(missing.diagnostics.some((d: { code: string }) => d.code === "ASTR7411")).toBe(true)
    const original = await readFile(missing.data.workspacePath, "utf8")
    const failing = await run(root, ["open", "--editor", "cursor"], {
      isExecutable: async () => true,
      launch: async () => ({ exitCode: 8 }),
    })
    expect(failing.diagnostics.some((d: { code: string }) => d.code === "ASTR7412")).toBe(true)
    expect(await readFile(missing.data.workspacePath, "utf8")).toBe(original)
    expect(process.exitCode).toBe(1)
  })

  it("rejects unsupported editors and invalid workspace files without dispatch", async () => {
    const { root } = await fixture()
    const launch = vi.fn(async () => ({ exitCode: 0 }))
    expect(
      (await run(root, ["open", "--editor", "unknown"], { launch })).diagnostics.some(
        (d: { code: string }) => d.code === "ASTR7410",
      ),
    ).toBe(true)
    expect(await pathExists(join(root, "editor.code-workspace"))).toBe(false)
    await writeFile(join(root, "editor.code-workspace"), "broken")
    expect((await run(root, ["open"], { launch })).success).toBe(false)
    expect(launch).not.toHaveBeenCalled()
  })

  it("discovers the built-in capability without a workspace and through capability list", async () => {
    const empty = await mkdtemp(join(tmpdir(), "astrail-editor-discovery-"))
    const discovery = await run(empty, ["editor", "list"])
    expect(discovery).toMatchObject({
      success: true,
      data: { id: "astrail-editor", editors: ["vscode", "cursor", "codebuddy"] },
    })
    const { root } = await fixture()
    expect((await run(root, ["capability", "list"])).data.builtins[0].skill).toBe("astrail-editor")
  })

  it("synchronizes init, bootstrap and sync without launching; previews remain read-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "astrail-editor-init-"))
    const launch = vi.fn(async () => ({ exitCode: 0 }))
    expect((await run(root, ["init", "--dry-run"], { launch })).data.created).toBe(false)
    expect(await pathExists(join(root, "astrail.yaml"))).toBe(false)
    const init = await run(root, ["init", "--skip-install"], { launch })
    expect(init.data.editorWorkspace.synchronized).toBe(true)
    expect(init.data.editorWorkspace.workspacePath).toBe(
      join(root, `${basename(root).toLowerCase()}.code-workspace`),
    )
    expect(init.data.nextSteps).toContainEqual(expect.objectContaining({ operation: "open" }))
    await mkdir(join(root, "source"))
    await writeFile(
      join(root, "astrail.yaml"),
      stringify({
        apiVersion: "astrail.dev/v1alpha1",
        kind: "Workspace",
        metadata: { name: "lifecycle" },
        repositories: {
          source: { access: "read-write", source: { type: "local", path: "source" } },
        },
      }),
    )
    const before = await readFile(init.data.editorWorkspace.workspacePath, "utf8")
    expect(
      (await run(root, ["bootstrap", "--dry-run"], { launch })).data.editorWorkspace.synchronized,
    ).toBe(false)
    expect(await readFile(init.data.editorWorkspace.workspacePath, "utf8")).toBe(before)
    expect(await pathExists(join(root, "lifecycle.code-workspace"))).toBe(false)
    const bootstrap = await run(root, ["bootstrap", "--yes"], { launch })
    expect(bootstrap.success).toBe(true)
    expect(bootstrap.data.editorWorkspace.synchronized).toBe(true)
    expect(bootstrap.data.editorWorkspace.workspacePath).toBe(
      join(root, "lifecycle.code-workspace"),
    )
    expect((await run(root, ["sync"], { launch })).data.editorWorkspace.synchronized).toBe(true)
    expect(launch).not.toHaveBeenCalled()
  })

  it("adds available repositories and exposes partial editor failure without undoing registration", async () => {
    const { root } = await fixture()
    await mkdir(join(root, "other"))
    const input = join(root, "request.json")
    await writeFile(
      input,
      JSON.stringify({
        id: "other",
        source: { type: "local", path: "other" },
        access: "read-write",
        description: "Other service",
      }),
    )
    const preview = await run(root, ["repo", "add", "--input", input, "--dry-run"])
    expect(preview.data.editorWorkspace.plan.folders).toEqual([
      { name: "editor (Workspace)", path: "." },
      { name: "other", path: "other" },
      { name: "web", path: "code" },
    ])
    expect(await pathExists(join(root, "editor.code-workspace"))).toBe(false)
    const added = await run(root, [
      "repo",
      "add",
      "--input",
      input,
      "--yes",
      "--plan-id",
      preview.data.plan.planId,
    ])
    expect(added.success).toBe(true)
    expect(added.data.editorWorkspace.synchronized).toBe(true)
    expect(
      added.data.nextSteps.some((step: { operation: string }) => step.operation === "open"),
    ).toBe(true)
    await writeFile(join(root, "editor.code-workspace"), "broken")
    const retry = await run(root, ["repo", "add", "--input", input, "--dry-run"])
    const partial = await run(root, [
      "repo",
      "add",
      "--input",
      input,
      "--yes",
      "--plan-id",
      retry.data.plan.planId,
    ])
    expect(partial).toMatchObject({
      success: false,
      data: {
        applied: true,
        preparation: { status: "ready" },
        editorWorkspace: { synchronized: false },
      },
    })
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toContain("other:")
  })

  it("keeps declaration-only missing repositories out until preparation", async () => {
    const { root } = await fixture()
    const input = join(root, "request.json")
    await writeFile(
      input,
      JSON.stringify({
        id: "later",
        source: { type: "git", url: "https://example.invalid/later.git" },
        access: "read-write",
        prepare: false,
      }),
    )
    const preview = await run(root, ["repo", "add", "--input", input, "--dry-run"])
    const added = await run(root, [
      "repo",
      "add",
      "--input",
      input,
      "--yes",
      "--plan-id",
      preview.data.plan.planId,
    ])
    expect(added.data.editorWorkspace.plan.skipped).toContainEqual({
      repository: "later",
      path: join(root, "repos/later"),
      reason: "missing",
    })
    expect(added.data.editorWorkspace.synchronized).toBe(true)
    expect(added.data.editorWorkspace.plan.folders).toEqual([
      { name: "editor (Workspace)", path: "." },
      { name: "web", path: "code" },
    ])
  })
})

describe("IDE adapters", () => {
  it.each([
    { platform: "darwin", executable: "/Applications/Cursor.app/Contents/Resources/app/bin/code" },
    { platform: "linux", executable: "/tools/cursor" },
    { platform: "win32", executable: "/tools/Cursor.exe" },
  ] as const)("requests the Cursor editor on $platform", async ({ platform, executable }) => {
    const { root } = await fixture()
    const workspace = await resolveWorkspace({ cwd: root })
    const workspacePath = join(root, "Team Project.code-workspace")
    const launch = await resolveEditorLaunch(workspace, "cursor", workspacePath, {
      platform,
      path: "/tools",
      isExecutable: async (path) => path === executable,
    })
    expect(launch).toMatchObject({
      executable,
      args: ["--classic", workspacePath],
      available: true,
    })
  })

  it("previews Cursor editor arguments even when the launcher is unavailable", async () => {
    const { root } = await fixture()
    const launch = vi.fn(async () => ({ exitCode: 0 }))
    const preview = await run(root, ["open", "--editor", "cursor", "--dry-run"], {
      isExecutable: async () => false,
      launch,
    })
    expect(preview.data.launch).toMatchObject({
      args: ["--classic", join(root, "editor.code-workspace")],
      available: false,
      status: "planned",
    })
    expect(launch).not.toHaveBeenCalled()
    expect(await pathExists(join(root, "editor.code-workspace"))).toBe(false)
  })

  it("resolves PATH launchers on Linux and executable launchers on Windows", async () => {
    const { root } = await fixture()
    const workspace = await resolveWorkspace({ cwd: root })
    const linux = await resolveEditorLaunch(
      workspace,
      "codebuddy",
      join(root, "editor.code-workspace"),
      {
        platform: "linux",
        path: "/tools",
        isExecutable: async (path) => path === "/tools/buddycn",
      },
    )
    expect(linux.executable).toBe("/tools/buddycn")
    const win = await resolveEditorLaunch(
      workspace,
      "vscode",
      join(root, "editor.code-workspace"),
      {
        platform: "win32",
        path: "/tools;/editors",
        isExecutable: async (path) => path === "/editors/Code.exe",
      },
    )
    expect(win.executable).toBe("/editors/Code.exe")
  })

  it("launches an executable with literal arguments without a shell, and reports exit failures", async () => {
    const { root } = await fixture()
    const script = join(root, "fake IDE.cjs")
    const argsFile = join(root, "arguments.json")
    await writeFile(
      script,
      'require("node:fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))',
    )
    const literal = "spaces $(touch SHOULD_NOT_EXIST) `echo unsafe` ; &.code-workspace"
    expect(
      (await launchEditorProcess(process.execPath, [script, argsFile, literal], root)).exitCode,
    ).toBe(0)
    expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual([literal])
    expect(await pathExists(join(root, "SHOULD_NOT_EXIST"))).toBe(false)
    expect(
      (await launchEditorProcess(process.execPath, ["-e", "process.exit(7)"], root)).exitCode,
    ).toBe(7)
    expect((await launchEditorProcess(join(root, "missing"), [], root)).error).toBeTruthy()
  })

  it.each(["codebuddy", "cursor"])(
    "uses a real configured %s launcher end to end",
    async (editor) => {
      if (process.platform === "win32") return
      const { root, config } = await fixture()
      const script = join(root, "fake IDE")
      await writeFile(
        script,
        '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("received.json", JSON.stringify(process.argv.slice(2)))\n',
      )
      await chmod(script, 0o755)
      await writeFile(
        join(root, "astrail.yaml"),
        stringify({ ...config, editor: { default: editor, executables: { [editor]: script } } }),
      )
      const workspace = await resolveWorkspace({ cwd: root })
      const preview = await openEditor(workspace, { dryRun: true })
      const expectedArgs =
        editor === "cursor"
          ? ["--classic", join(root, "editor.code-workspace")]
          : [join(root, "editor.code-workspace")]
      expect(preview.data.launch?.args).toEqual(expectedArgs)
      expect(await pathExists(join(root, "received.json"))).toBe(false)
      const opened = await openEditor(workspace, {})
      expect(opened.success).toBe(true)
      expect(JSON.parse(await readFile(join(root, "received.json"), "utf8"))).toEqual(expectedArgs)
    },
  )
})
