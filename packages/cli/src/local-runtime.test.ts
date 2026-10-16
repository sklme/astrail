import { spawn } from "node:child_process"
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pathExists, runProcess } from "astrail-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readLaunchOptions, selectLocalRuntime } from "./local-runtime.js"
import { CLI_VERSION } from "./program.js"
import { ASTRAIL_PACKAGE } from "./workspace-package.js"

const globalEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url))
const roots: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(range?: string, config = "astrail.yaml") {
  const root = await mkdtemp(join(tmpdir(), "astrail-runtime-"))
  roots.push(root)
  await writeFile(
    join(root, config),
    "apiVersion: astrail.dev/v1alpha1\nkind: Workspace\nmetadata: { name: runtime }\n",
  )
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      private: true,
      devDependencies: range ? { [ASTRAIL_PACKAGE]: range } : {},
      packageManager: "pnpm@11.20.0",
    }),
  )
  return root
}

async function install(
  root: string,
  version = "0.3.4",
  script = "process.stdout.write('local-runtime\\n')",
) {
  const localRoot = join(root, "node_modules/astrail")
  await mkdir(localRoot, { recursive: true })
  await writeFile(
    join(localRoot, "package.json"),
    JSON.stringify({ name: ASTRAIL_PACKAGE, version, bin: { astrail: "cli.cjs" } }),
  )
  const entry = join(localRoot, "cli.cjs")
  await writeFile(entry, script)
  return realpath(entry)
}

describe("workspace runtime selection", () => {
  it("uses a user global preference before inspecting an obsolete or corrupt local dependency", async () => {
    const root = await fixture("~0.3.0")
    const entry = await install(root)
    await writeFile(join(root, "package.json"), "{broken")
    const user = join(root, "user.yaml")
    await writeFile(user, "runtime: { mode: global }\n")
    vi.stubEnv("ASTRAIL_USER_CONFIG", user)
    expect(
      await selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).toBeUndefined()
    await expect(
      selectLocalRuntime({ cwd: root, command: "status", json: false }, entry),
    ).rejects.toThrow("globally installed")
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--cwd",
      root,
      "--json",
      "status",
    ])
    const envelope = JSON.parse(executed.stdout)
    expect(envelope.data.runtime).toMatchObject({
      mode: "global",
      modeSource: user,
      source: "launcher",
      version: CLI_VERSION,
      executable: globalEntry,
    })
    expect(envelope.data.config.runtime).toEqual({ mode: "global" })
  })

  it("honors a workspace local override of the user default", async () => {
    const root = await fixture("~0.3.0")
    const entry = await install(root)
    const user = join(root, "user.yaml")
    await writeFile(user, "runtime: { mode: global }\n")
    vi.stubEnv("ASTRAIL_USER_CONFIG", user)
    await appendFile(join(root, "astrail.yaml"), "runtime: { mode: local }\n")
    expect(
      await selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).toBe(entry)
  })

  it("requires a local installation for explicit local mode even without a package declaration", async () => {
    const root = await fixture()
    await appendFile(join(root, "astrail.yaml"), "runtime: { mode: local }\n")
    await expect(
      selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).rejects.toThrow("runtime.mode is local")
  })

  it("continues enforcing workspace compatibility when global mode ignores a stale local version", async () => {
    const root = await fixture("~0.3.0")
    await install(root)
    await appendFile(
      join(root, "astrail.yaml"),
      'runtime: { mode: global }\nrequires: { astrail: ">=99.0.0" }\n',
    )
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--cwd",
      root,
      "--json",
      "sync",
      "--yes",
    ])
    expect(executed.exitCode).not.toBe(0)
    expect(
      JSON.parse(executed.stdout).diagnostics.some(
        (item: { code: string }) => item.code === "ASTR1202",
      ),
    ).toBe(true)
    expect(await pathExists(join(root, "AGENTS.md"))).toBe(false)
  })

  it("routes global init before a missing dependency and rejects invalid runtime flags", async () => {
    const root = await fixture("~0.3.0")
    expect(
      await selectLocalRuntime(
        readLaunchOptions(["init", "--cwd", root, "--runtime=global"]),
        globalEntry,
      ),
    ).toBeUndefined()
    expect(() => readLaunchOptions(["init", "--runtime", "latest"])).toThrow("global or local")
    await expect(
      selectLocalRuntime(
        readLaunchOptions(["status", "--cwd", root, "--runtime=global"]),
        globalEntry,
      ),
    ).rejects.toThrow("init option")
  })

  it("accepts patch updates within ~ and discovers the workspace from a child repository", async () => {
    const root = await fixture("~0.3.0")
    const entry = await install(root)
    const child = join(root, "repos/application")
    await mkdir(child, { recursive: true })
    await install(child, "9.0.0")
    expect(
      await selectLocalRuntime({ cwd: child, command: "status", json: false }, globalEntry),
    ).toBe(entry)
  })

  it("uses an explicit config relative to --cwd", async () => {
    const root = await fixture("~0.3.0", "custom.yaml")
    const entry = await install(root)
    const child = join(root, "child")
    await mkdir(child)
    expect(
      await selectLocalRuntime(
        readLaunchOptions(["status", "--cwd", child, "--config=../custom.yaml"]),
        globalEntry,
      ),
    ).toBe(entry)
  })

  it("falls back only for undeclared legacy workspaces or outside a workspace", async () => {
    const legacy = await fixture()
    expect(
      await selectLocalRuntime({ cwd: legacy, command: "status", json: false }, globalEntry),
    ).toBeUndefined()
    const outside = await mkdtemp(join(tmpdir(), "astrail-outside-"))
    roots.push(outside)
    expect(
      await selectLocalRuntime({ cwd: outside, command: "status", json: false }, globalEntry),
    ).toBeUndefined()
  })

  it("uses an installed local runtime even if the workspace has no declaration", async () => {
    const root = await fixture()
    const entry = await install(root)
    expect(
      await selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).toBe(entry)
  })

  it.each(["~0.3.0", "0.3.0", "^0.3.0"])(
    "refuses missing dependencies declared as %s",
    async (range) => {
      const root = await fixture(range)
      await expect(
        selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
      ).rejects.toThrow("pnpm install")
    },
  )

  it("refuses an out-of-range version even when the global version would match", async () => {
    const root = await fixture(`~${CLI_VERSION}`)
    await install(root, "9.0.0")
    await expect(
      selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).rejects.toThrow("does not satisfy")
  })

  it("refuses a broken executable and a broken package symlink", async () => {
    const root = await fixture("~0.3.0")
    const entry = await install(root)
    await rm(entry)
    await expect(
      selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).rejects.toThrow("executable is missing")
    const packageRoot = join(root, "node_modules/astrail")
    await rm(packageRoot, { recursive: true })
    await symlink(join(root, "nonexistent"), packageRoot)
    await expect(
      selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).rejects.toThrow("Invalid local")
  })

  it("does not inherit the parent workspace runtime when initializing a nested workspace", async () => {
    const root = await fixture("~0.3.0")
    await install(root)
    expect(
      await selectLocalRuntime(
        { cwd: join(root, "new-workspace"), command: "init", json: false },
        globalEntry,
      ),
    ).toBeUndefined()
  })

  it("reports installation guidance for corrupt local package metadata", async () => {
    const root = await fixture("~0.3.0")
    const entry = await install(root)
    await writeFile(join(dirname(entry), "package.json"), "{invalid")
    await expect(
      selectLocalRuntime({ cwd: root, command: "status", json: false }, globalEntry),
    ).rejects.toThrow("pnpm install")
  })

  it("stays in the current runtime when already executing the local binary, including symlinks", async () => {
    const root = await fixture("~0.3.0")
    const entry = await install(root)
    const symlinked = join(root, "linked-cli.cjs")
    await symlink(entry, symlinked)
    expect(
      await selectLocalRuntime({ cwd: root, command: "status", json: false }, symlinked),
    ).toBeUndefined()
  })

  it("does not forward arguments after -- as launcher options", () => {
    expect(
      readLaunchOptions(["--cwd=workspace", "status", "--", "--config=other", "--json"]),
    ).toEqual({ cwd: "workspace", command: "status", json: false })
  })
})

describe("CLI launcher subprocess", () => {
  it("rejects an acquired config whose runtime requirement cannot be satisfied", async () => {
    const root = await fixture()
    const remote = join(root, "config-source")
    await mkdir(remote)
    await writeFile(
      join(remote, "astrail.config.yaml"),
      JSON.stringify({
        apiVersion: "astrail.dev/v1alpha1",
        metadata: { name: "future", version: "1.0.0" },
        requires: { astrail: ">=99.0.0" },
        repositories: {
          unavailable: {
            access: "read-write",
            source: { type: "git", url: join(root, "must-not-be-cloned") },
          },
        },
      }),
    )
    for (const args of [
      ["init", "-b", "main"],
      ["add", "."],
      [
        "-c",
        "user.name=Astrail Test",
        "-c",
        "user.email=astrail@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
    ]) {
      expect((await runProcess("git", args, { cwd: remote })).exitCode).toBe(0)
    }
    await appendFile(join(root, "astrail.yaml"), `extends:\n  - git: ${JSON.stringify(remote)}\n`)
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--cwd",
      root,
      "--json",
      "bootstrap",
      "--yes",
    ])
    expect(executed.exitCode).toBe(1)
    const envelope = JSON.parse(executed.stdout)
    expect(envelope.diagnostics.some((item: { code: string }) => item.code === "ASTR1202")).toBe(
      true,
    )
    expect(envelope.data.bootstrap.at(-1).actions).toHaveLength(1)
    expect(await pathExists(join(root, "repos/unavailable"))).toBe(false)
    expect(await pathExists(join(root, "AGENTS.md"))).toBe(false)
  })

  it("checks the chosen local version rather than rejecting a compatible newer runtime based on the global version", async () => {
    const root = await fixture("~98.0.0")
    await appendFile(join(root, "astrail.yaml"), 'requires: { astrail: ">=98.0.5 <98.1.0" }\n')
    await install(root, "98.0.9")
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--cwd",
      root,
      "future-command",
    ])
    expect(executed.exitCode).toBe(0)
    expect(executed.stdout.trim()).toBe("local-runtime")
  })

  it("blocks an incompatible local runtime even when it predates requirement checks", async () => {
    const root = await fixture("~0.2.0")
    await appendFile(join(root, "astrail.yaml"), 'requires: { astrail: ">=0.3.0 <0.4.0" }\n')
    await install(root, "0.2.9", "require('node:fs').writeFileSync('should-not-execute', 'bad')")
    const executed = await runProcess(
      process.execPath,
      [globalEntry, "--cwd", root, "--json", "status"],
      { cwd: root },
    )
    expect(executed.exitCode).toBe(1)
    const envelope = JSON.parse(executed.stdout)
    expect(envelope.data.runtime).toMatchObject({ version: "0.2.9", supported: false })
    expect(envelope.diagnostics[0]?.code).toBe("ASTR1202")
    expect(await pathExists(join(root, "should-not-execute"))).toBe(false)
  })

  it.each([["sync", "--yes"], ["lock"], ["doctor"], ["config", "show"]])(
    "refuses an incompatible fallback runtime before executing %j",
    async (...command) => {
      const root = await fixture()
      await appendFile(join(root, "astrail.yaml"), 'requires: { astrail: ">=99.0.0" }\n')
      const executed = await runProcess(process.execPath, [
        globalEntry,
        "--cwd",
        root,
        "--json",
        ...command,
      ])
      expect(executed.exitCode).toBe(1)
      const envelope = JSON.parse(executed.stdout)
      expect(envelope.data.runtime).toMatchObject({ version: CLI_VERSION, supported: false })
      expect(envelope.diagnostics[0]?.code).toBe("ASTR1202")
      expect(await pathExists(join(root, "AGENTS.md"))).toBe(false)
      expect(await pathExists(join(root, "astrail.lock.yaml"))).toBe(false)
      expect(await pathExists(join(root, ".astrail"))).toBe(false)
    },
  )

  it("reports the executing version in compatible doctor output", async () => {
    const root = await fixture()
    await appendFile(join(root, "astrail.yaml"), `requires: { astrail: "${CLI_VERSION}" }\n`)
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--cwd",
      root,
      "--json",
      "doctor",
    ])
    expect(executed.exitCode).toBe(0)
    expect(JSON.parse(executed.stdout).data.tools).toMatchObject({
      astrail: CLI_VERSION,
      astrailSupported: true,
    })
  })

  it("honors compatibility requirements selected by --config from a child directory", async () => {
    const root = await fixture(undefined, "custom.yaml")
    await appendFile(join(root, "custom.yaml"), 'requires: { astrail: ">=99.0.0" }\n')
    const child = join(root, "child")
    await mkdir(child)
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--cwd",
      child,
      "--config",
      "../custom.yaml",
      "--json",
      "lock",
    ])
    expect(executed.exitCode).toBe(1)
    expect(JSON.parse(executed.stdout).diagnostics[0].location.file).toBe(join(root, "custom.yaml"))
  })

  it("checks init --force requirements before replacing an existing workspace", async () => {
    const root = await fixture()
    await appendFile(join(root, "astrail.yaml"), 'requires: { astrail: ">=99.0.0" }\n')
    const before = await readFile(join(root, "astrail.yaml"), "utf8")
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--cwd",
      root,
      "--json",
      "init",
      "--force",
      "--skip-install",
    ])
    expect(executed.exitCode).toBe(1)
    expect(JSON.parse(executed.stdout).diagnostics[0]?.code).toBe("ASTR1202")
    expect(await readFile(join(root, "astrail.yaml"), "utf8")).toBe(before)
  })

  it("preserves the usage exit code for missing routing option arguments", async () => {
    const executed = await runProcess(process.execPath, [globalEntry, "--json", "--cwd"])
    expect(executed.exitCode).toBe(2)
    expect(JSON.parse(executed.stdout)).toMatchObject({ success: false })
  })

  it("delegates unknown commands before parsing, preserving arguments, cwd, stdout, stderr, and exit codes", async () => {
    const root = await fixture("~0.3.0")
    await install(
      root,
      "0.3.4",
      "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() })); process.stderr.write('local diagnostic'); process.exitCode = 17",
    )
    const args = ["--json", "future-command", "--future-option", "value", "--cwd", root]
    const executed = await runProcess(process.execPath, [globalEntry, ...args], { cwd: tmpdir() })
    expect(executed.exitCode).toBe(17)
    expect(JSON.parse(executed.stdout)).toEqual({ args, cwd: await realpath(tmpdir()) })
    expect(executed.stderr).toBe("local diagnostic")
  })

  it("returns structured errors for unavailable local versions without running a global command", async () => {
    const root = await fixture("~0.3.0")
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--json",
      "--cwd",
      root,
      "status",
    ])
    expect(executed.exitCode).toBe(3)
    expect(JSON.parse(executed.stdout)).toMatchObject({
      command: "status",
      success: false,
      diagnostics: [{ code: "ASTR8100", message: expect.stringContaining("pnpm install") }],
    })
    expect(executed.stderr).toBe("")
  })

  it("executes normally with the real CLI linked locally and does not recurse", async () => {
    const root = await fixture(`~${CLI_VERSION}`)
    const scope = join(root, "node_modules")
    await mkdir(scope, { recursive: true })
    await symlink(dirname(dirname(globalEntry)), join(scope, "astrail"))
    const executed = await runProcess(process.execPath, [globalEntry, "--cwd", root, "--version"])
    expect(executed.exitCode).toBe(0)
    expect(executed.stdout.trim()).toBe(CLI_VERSION)
  })

  it("detects a wrapper that delegates back to the global entry", async () => {
    const root = await fixture("~0.3.0")
    await install(root, "0.3.4", `import(${JSON.stringify(globalEntry)})`)
    const executed = await runProcess(process.execPath, [
      globalEntry,
      "--json",
      "--cwd",
      root,
      "status",
    ])
    expect(executed.exitCode).toBe(3)
    expect(JSON.parse(executed.stdout).diagnostics[0].message).toContain("Recursive")
  })

  it("preserves child signal termination", async () => {
    const root = await fixture("~0.3.0")
    await install(root, "0.3.4", "process.kill(process.pid, 'SIGTERM')")
    const termination = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [globalEntry, "--cwd", root, "status"], {
          stdio: "ignore",
        })
        child.once("error", reject)
        child.once("exit", (code, signal) => resolve({ code, signal }))
      },
    )
    expect(termination).toEqual({ code: null, signal: "SIGTERM" })
  })

  it("forwards termination signals from the launcher to the local process", async () => {
    const root = await fixture("~0.3.0")
    await install(
      root,
      "0.3.4",
      "process.on('SIGTERM', () => process.exit(23)); process.stdout.write('ready'); setInterval(() => {}, 1000)",
    )
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [globalEntry, "--cwd", root, "status"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
      child.once("error", reject)
      child.stdout.once("data", () => child.kill("SIGTERM"))
      child.once("exit", (code) => resolve(code))
    })
    expect(code).toBe(23)
  })
})
