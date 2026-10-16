import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathExists, type runProcess } from "astrail-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { parse } from "yaml"
import { CLI_VERSION, createProgram } from "./program.js"
import { initializeWorkspace, minimalWorkspaceRange } from "./workspace-init.js"
import { ASTRAIL_PACKAGE, DEFAULT_PNPM_VERSION } from "./workspace-package.js"

const roots: string[] = []
const originalExitCode = process.exitCode
afterEach(async () => {
  process.exitCode = originalExitCode
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(manifest?: object) {
  const root = await mkdtemp(join(tmpdir(), "astrail-init-"))
  roots.push(root)
  if (manifest) await writeFile(join(root, "package.json"), JSON.stringify(manifest))
  return root
}

const writer = { out: () => undefined, err: () => undefined }
async function installedPackage(root: string, version = CLI_VERSION) {
  const directory = join(root, "node_modules", ...ASTRAIL_PACKAGE.split("/"))
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: ASTRAIL_PACKAGE, version }),
  )
}

function installer(version = "11.20.0") {
  return vi.fn<typeof runProcess>(async (_manager, args, options) => {
    if (args[0] === "--version") return { exitCode: 0, stdout: `${version}\n`, stderr: "" }
    await writeFile(join(options?.cwd ?? "", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
    await installedPackage(options?.cwd ?? "")
    return { exitCode: 0, stdout: "Installed dependencies\n", stderr: "" }
  })
}

describe("workspace initialization", () => {
  it("writes the Pages Schema URL without changing protocol identity", async () => {
    const root = await fixture()
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION, skipInstall: true },
      writer,
      installer(),
    )
    expect(initialized.success).toBe(true)
    expect(parse(await readFile(join(root, "astrail.yaml"), "utf8"))).toMatchObject({
      $schema: "https://sklme.github.io/astrail/schema/workspace/v1alpha1.json",
      apiVersion: "astrail.dev/v1alpha1",
    })
  })

  it("previews package and editor initialization without writes or package-manager execution", async () => {
    const parent = await fixture()
    const root = join(parent, "new-workspace")
    const runner = installer()
    const preview = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION, dryRun: true },
      writer,
      runner,
    )
    expect(preview.success).toBe(true)
    expect(preview.data).toMatchObject({
      created: false,
      installed: false,
      editorWorkspace: { synchronized: false },
    })
    expect(preview.data.nextSteps).toContain("Install workspace dependencies with pnpm install.")
    expect(runner).not.toHaveBeenCalled()
    expect(await readdir(parent)).toEqual([])
  })

  it("checks the actual installed version against a narrower preserved requirement", async () => {
    const root = await fixture({ devDependencies: { [ASTRAIL_PACKAGE]: "~0.3.0" } })
    await writeFile(
      join(root, "astrail.yaml"),
      'apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: pinned }\nrequires: { astrail: ">=0.3.0 <0.3.5" }\n',
    )
    const runner = vi.fn<typeof runProcess>(async (_manager, args) => {
      if (args[0] === "install") await installedPackage(root, "0.3.9")
      return { exitCode: 0, stdout: args[0] === "--version" ? "11.20.0" : "", stderr: "" }
    })
    const initialized = await initializeWorkspace(
      { cwd: root, force: true, version: "0.3.0" },
      writer,
      runner,
    )
    expect(initialized.success).toBe(false)
    expect(initialized.data).toMatchObject({ created: true, installed: false })
    expect(initialized.diagnostics[0]).toMatchObject({
      code: "ASTR1202",
      details: { version: "0.3.9" },
    })
  })

  it("does not report successful initialization when installation omitted dev dependencies", async () => {
    const root = await fixture()
    const runner = vi.fn<typeof runProcess>(async (_manager, args) => ({
      exitCode: 0,
      stdout: args[0] === "--version" ? "11.20.0" : "",
      stderr: "",
    }))
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION },
      writer,
      runner,
    )
    expect(initialized.success).toBe(false)
    expect(initialized.diagnostics[0]?.code).toBe("ASTR8103")
  })

  it("keeps the template compatibility floor stable across patch releases", () => {
    expect(minimalWorkspaceRange("0.3.1")).toBe(">=0.3.0 <0.4.0")
    expect(minimalWorkspaceRange("0.3.9")).toBe(">=0.3.0 <0.4.0")
    expect(minimalWorkspaceRange("0.4.0-beta.1")).toBe(">=0.4.0-beta.1 <0.5.0")
  })

  it("refuses force initialization with an incompatible requirement before any write or installation", async () => {
    const root = await fixture({ scripts: { test: "preserve" } })
    const workspace =
      'apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: existing }\nrequires: { astrail: ">=99.0.0" }\n'
    await writeFile(join(root, "astrail.yaml"), workspace)
    const packageBefore = await readFile(join(root, "package.json"), "utf8")
    const runner = installer()
    const initialized = await initializeWorkspace(
      { cwd: root, force: true, version: CLI_VERSION },
      writer,
      runner,
    )
    expect(initialized.success).toBe(false)
    expect(initialized.diagnostics[0]?.code).toBe("ASTR1202")
    expect(runner).not.toHaveBeenCalled()
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(workspace)
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(packageBefore)
  })

  it("preserves an explicit compatible requirement during force initialization", async () => {
    const root = await fixture()
    await writeFile(
      join(root, "astrail.yaml"),
      `apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: existing }\nrequires: { astrail: ">=${CLI_VERSION}" }\n`,
    )
    const initialized = await initializeWorkspace(
      { cwd: root, force: true, skipInstall: true, version: CLI_VERSION },
      writer,
    )
    expect(initialized.success).toBe(true)
    expect(parse(await readFile(join(root, "astrail.yaml"), "utf8")).requires).toEqual({
      astrail: `>=${CLI_VERSION}`,
    })
  })

  it("rejects a dependency range disjoint from the template requirement without changing package.json", async () => {
    const root = await fixture({ dependencies: { [ASTRAIL_PACKAGE]: "~0.2.3" } })
    const before = await readFile(join(root, "package.json"), "utf8")
    const initialized = await initializeWorkspace(
      { cwd: root, version: "0.3.0", skipInstall: true },
      writer,
    )
    expect(initialized.success).toBe(false)
    expect(initialized.diagnostics[0]?.message).toContain("no overlap")
    expect(await pathExists(join(root, "astrail.yaml"))).toBe(false)
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(before)
  })

  it("pins the pnpm version, declares a tilde dependency, and installs in the new workspace", async () => {
    const root = await fixture()
    const runner = installer("11.20.1")
    const initialized = await initializeWorkspace(
      { cwd: root, name: "My Workspace", version: CLI_VERSION },
      writer,
      runner,
    )
    expect(initialized.success).toBe(true)
    expect(initialized.data).toMatchObject({
      created: true,
      installed: true,
      packageManager: "pnpm@11.20.1",
      editorWorkspace: { synchronized: true },
    })
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8"))).toEqual({
      name: "my-workspace",
      private: true,
      packageManager: "pnpm@11.20.1",
      devDependencies: { [ASTRAIL_PACKAGE]: `~${CLI_VERSION}` },
    })
    expect(parse(await readFile(join(root, "astrail.yaml"), "utf8"))).toMatchObject({
      metadata: { name: "my-workspace" },
      requires: { astrail: minimalWorkspaceRange(CLI_VERSION) },
    })
    expect(runner).toHaveBeenLastCalledWith("pnpm", ["install"], { cwd: root, timeoutMs: 300_000 })
    expect(await pathExists(join(root, "pnpm-lock.yaml"))).toBe(true)
  })

  it("scaffolds offline without invoking a package manager", async () => {
    const parent = await fixture()
    const root = join(parent, "new-workspace")
    const runner = installer()
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION, skipInstall: true },
      writer,
      runner,
    )
    expect(initialized.success).toBe(true)
    expect(initialized.data).toMatchObject({
      installed: false,
      packageManager: `pnpm@${DEFAULT_PNPM_VERSION}`,
    })
    expect(initialized.data.nextSteps[0]).toContain("pnpm install")
    expect(runner).not.toHaveBeenCalled()
  })

  it("merges an existing package without changing scripts, dependencies, or package manager", async () => {
    const existing = {
      name: "existing",
      private: false,
      scripts: { test: "custom" },
      dependencies: { example: "1.0.0" },
      devDependencies: { tool: "2.0.0" },
      packageManager: "pnpm@11.20.0+sha512.abc",
    }
    const root = await fixture(existing)
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION },
      writer,
      installer(),
    )
    expect(initialized.success).toBe(true)
    expect(JSON.parse(await readFile(join(root, "package.json"), "utf8"))).toEqual({
      ...existing,
      devDependencies: { ...existing.devDependencies, [ASTRAIL_PACKAGE]: `~${CLI_VERSION}` },
    })
  })

  it("preserves an existing Astrail dependency range and section", async () => {
    const root = await fixture({ dependencies: { [ASTRAIL_PACKAGE]: `~${CLI_VERSION}` } })
    await initializeWorkspace({ cwd: root, version: CLI_VERSION, skipInstall: true }, writer)
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
    expect(manifest.dependencies[ASTRAIL_PACKAGE]).toBe(`~${CLI_VERSION}`)
    expect(manifest.devDependencies).toBeUndefined()
  })

  it.each([
    ["npm", "package-lock.json", "10.9.0"],
    ["yarn", "yarn.lock", "4.9.0"],
  ])(
    "adopts an existing %s lockfile without switching to pnpm",
    async (manager, lockfile, version) => {
      const root = await fixture({ scripts: { build: "custom" } })
      await writeFile(join(root, lockfile), "original-lock")
      const runner = vi.fn<typeof runProcess>(async (_manager, args) => {
        if (args[0] === "install") await installedPackage(root)
        return {
          exitCode: 0,
          stdout: args[0] === "--version" ? version : "",
          stderr: "",
        }
      })
      const initialized = await initializeWorkspace(
        { cwd: root, version: CLI_VERSION },
        writer,
        runner,
      )
      expect(initialized.success).toBe(true)
      expect(initialized.data.packageManager).toBe(`${manager}@${version}`)
      expect(runner).toHaveBeenLastCalledWith(manager, ["install"], {
        cwd: root,
        timeoutMs: 300_000,
      })
      expect(await pathExists(join(root, "pnpm-lock.yaml"))).toBe(false)
    },
  )

  it.each([
    [undefined, ["pnpm-lock.yaml", "yarn.lock"]],
    ["npm@10.9.0", ["pnpm-lock.yaml"]],
  ])("refuses conflicting lockfiles before mutating files", async (packageManager, files) => {
    const root = await fixture(packageManager ? { packageManager } : {})
    const before = await readFile(join(root, "package.json"), "utf8")
    for (const file of files) await writeFile(join(root, file), "lock")
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION, force: true },
      writer,
      installer(),
    )
    expect(initialized.success).toBe(false)
    expect(initialized.diagnostics[0]?.message).toContain("Conflicting")
    expect(await pathExists(join(root, "astrail.yaml"))).toBe(false)
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(before)
  })

  it("reports missing pnpm with an offline alternative and leaves existing files alone", async () => {
    const root = await fixture({ scripts: { test: "existing" } })
    const before = await readFile(join(root, "package.json"), "utf8")
    const runner = vi.fn<typeof runProcess>(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "ENOENT",
    }))
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION },
      writer,
      runner,
    )
    expect(initialized.success).toBe(false)
    expect(initialized.diagnostics[0]?.message).toContain("--skip-install")
    expect(await readFile(join(root, "package.json"), "utf8")).toBe(before)
    expect(await pathExists(join(root, "astrail.yaml"))).toBe(false)
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it("does not install using a different package manager version", async () => {
    const root = await fixture({ packageManager: "pnpm@11.20.0" })
    const runner = installer("10.0.0")
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION },
      writer,
      runner,
    )
    expect(initialized.success).toBe(false)
    expect(initialized.diagnostics[0]?.message).toContain("does not match")
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it("retains usable workspace files and reports how to recover after install failure", async () => {
    const root = await fixture()
    const runner = vi.fn<typeof runProcess>(async (_manager, args) =>
      args[0] === "--version"
        ? { exitCode: 0, stdout: "11.20.0", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "registry unavailable" },
    )
    const initialized = await initializeWorkspace(
      { cwd: root, version: CLI_VERSION },
      writer,
      runner,
    )
    expect(initialized.success).toBe(false)
    expect(initialized.data).toMatchObject({ created: true, installed: false })
    expect(initialized.diagnostics[0]?.remediation).toContain("rerunning init is unnecessary")
    expect(await pathExists(join(root, "package.json"))).toBe(true)
    expect(await pathExists(join(root, "astrail.yaml"))).toBe(true)
  })

  it("keeps package manager logs on stderr and JSON parseable on stdout", async () => {
    const root = await fixture()
    const stdout: string[] = []
    const stderr: string[] = []
    await createProgram(
      { out: (text) => stdout.push(text), err: (text) => stderr.push(text) },
      { packageManagerRunner: installer() },
    ).parseAsync(["--json", "--cwd", root, "init"], { from: "user" })
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      command: "init",
      success: true,
      data: { installed: true },
    })
    expect(stderr.join("")).toContain("Installed dependencies")
  })

  it("honors an explicit config path and refuses overwrites without --force", async () => {
    const root = await fixture()
    const options = {
      cwd: root,
      config: "custom/workspace.yaml",
      version: CLI_VERSION,
      skipInstall: true,
    }
    expect((await initializeWorkspace(options, writer)).success).toBe(true)
    expect(await pathExists(join(root, "custom/package.json"))).toBe(true)
    expect((await initializeWorkspace(options, writer)).success).toBe(false)
    expect((await initializeWorkspace({ ...options, force: true }, writer)).success).toBe(true)
  })
})
