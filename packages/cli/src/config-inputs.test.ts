import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"
import { stringify } from "yaml"
import { createProgram } from "./program.js"

const roots: string[] = []
const originalExitCode = process.exitCode
afterEach(async () => {
  process.exitCode = originalExitCode
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function command(root: string, args: string[]) {
  const stdout: string[] = []
  await createProgram({ out: (value) => stdout.push(value), err: () => {} }).parseAsync(
    ["--json", "--cwd", root, ...args],
    { from: "user" },
  )
  return JSON.parse(stdout.join(""))
}
it("hands current inputs to setup and daily Skills and re-queries edits without synchronization", async () => {
  const root = await mkdtemp(join(tmpdir(), "astrail-input-cli-"))
  roots.push(root)
  await mkdir(join(root, "skill"))
  await writeFile(
    join(root, "skill/SKILL.md"),
    "---\nname: example\ndescription: Example\n---\nRead current inputs.\n",
  )
  const config = {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "test" },
    extends: [{ local: "./shared.yaml", with: { repository: "old" } }],
  }
  await writeFile(join(root, "astrail.yaml"), stringify(config))
  await writeFile(
    join(root, "shared.yaml"),
    stringify({
      inputs: {
        type: "object",
        additionalProperties: false,
        required: ["repository"],
        properties: { repository: { type: "string" } },
      },
      setup: { mode: "skill", skill: "test/setup" },
      capabilities: {
        setup: { kind: "skill", identity: "test/setup", source: { type: "config", path: "skill" } },
        record: {
          kind: "skill",
          identity: "test/record",
          source: { type: "config", path: "skill" },
        },
      },
    }),
  )
  const install = await command(root, ["install", "--yes"])
  expect(install.success, JSON.stringify(install.diagnostics)).toBe(true)
  const setup = install.data.setup[0]
  expect(setup.status).toBe("available")
  expect(setup.inputsPath).toBe(join(root, ".astrail/config-inputs", `${setup.configKey}.json`))
  expect(JSON.parse(await readFile(setup.inputsPath, "utf8")).inputs).toEqual({ repository: "old" })
  const originalLock = await readFile(join(root, "astrail.lock.yaml"), "utf8")
  const reference = config.extends[0]
  if (!reference) throw new Error("Missing test reference")
  reference.with.repository = "new"
  await writeFile(join(root, "astrail.yaml"), stringify(config))
  const current = await command(root, ["config", "inputs", "--capability", "test/record"])
  expect(current.success).toBe(true)
  expect(current.data.inputs).toEqual({ repository: "new" })
  expect(current.data.bindingDigest).not.toBe(setup.bindingDigest)
  expect(await readFile(join(root, "astrail.lock.yaml"), "utf8")).toBe(originalLock)
  expect((await command(root, ["config", "inputs", "--key", setup.configKey])).data.inputs).toEqual(
    { repository: "new" },
  )
  expect((await command(root, ["config", "inputs"])).success).toBe(false)
})
