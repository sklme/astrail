import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { stringify } from "yaml"
import { bindConfigInputs } from "./config-inputs.js"
import { resolveWorkspace } from "./resolver.js"
import { applySkillAddition, planSkillAddition } from "./skill-authoring.js"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", default: "Journal" },
    delivery: { type: "string", enum: ["local", "push"], default: "local" },
  },
}
const bind = (inputs: unknown, supplied: Record<string, unknown> = {}) =>
  bindConfigInputs({
    schema: inputs,
    supplied,
    file: "config.yaml",
    reference: { file: "astrail.yaml", pointer: "/extends/0/with", kind: "with" },
    key: "key",
  })
async function fixture(refs: unknown[], extra: object = {}) {
  const root = await mkdtemp(join(tmpdir(), "astrail-inputs-"))
  roots.push(root)
  await yaml(root, "astrail.yaml", {
    apiVersion: "astrail.dev/v1alpha1",
    kind: "Workspace",
    metadata: { name: "test" },
    extends: refs,
    ...extra,
  })
  return root
}
async function yaml(root: string, file: string, value: unknown) {
  await writeFile(join(root, file), stringify(value))
}
describe("shared config inputs", () => {
  it("invalidates authoring plans when shared defaults change without changing the Workspace file", async () => {
    const root = await fixture(["./base.yaml"])
    await yaml(root, "base.yaml", { inputs: schema })
    await mkdir(join(root, "skill"))
    await writeFile(join(root, "skill/SKILL.md"), "# Example")
    const input = { identity: "example/new", source: { type: "workspace", path: "skill" } }
    const before = await planSkillAddition(input, { cwd: root })
    expect(before.diagnostics.filter((item) => item.severity === "error")).toEqual([])
    await yaml(root, "base.yaml", {
      inputs: {
        ...schema,
        properties: { ...schema.properties, title: { type: "string", default: "Updated" } },
      },
    })
    expect((await planSkillAddition(input, { cwd: root })).planId).not.toBe(before.planId)
    expect(
      (await applySkillAddition(before, { authorized: true })).diagnostics.some(
        (item) => item.code === "ASTR1119",
      ),
    ).toBe(true)
  })

  it("fills nested defaults without creating optional objects, preserves explicit null and array values", () => {
    const child = {
      type: "object",
      additionalProperties: false,
      properties: { n: { type: "integer", default: 2 } },
    }
    const input = {
      type: "object",
      additionalProperties: false,
      properties: {
        absent: child,
        present: { ...child, default: {} },
        nil: { type: "null", default: null },
        list: { type: "array", items: { type: "integer" }, default: [1, 2] },
      },
    }
    expect(bind(input, { list: [3], nil: null }).inputs).toEqual({
      present: { n: 2 },
      list: [3],
      nil: null,
    })
    expect(bind(input).inputOrigins?.["/present/n"]).toMatchObject({
      kind: "default",
      file: "config.yaml",
    })
  })
  it.each([
    [schema, { title: 42 }],
    [schema, { title: null }],
    [schema, { typo: true }],
    [{ ...schema, properties: { title: { type: "string", default: 42 } } }, {}],
    [
      {
        ...schema,
        properties: {
          hidden: {
            type: "object",
            additionalProperties: false,
            properties: { n: { type: "integer", default: "bad" } },
          },
        },
      },
      {},
    ],
    [{ ...schema, $ref: "https://example.invalid/schema" }, {}],
    [undefined, { title: "unsupported" }],
    [schema, JSON.parse('{"__proto__": {"polluted": true}}')],
    [schema, { title: { $input: "title" } }],
  ])("rejects invalid values and contracts", (input, supplied) => {
    expect(() => bind(input, supplied)).toThrow()
  })
  it("recursively fills object default fields while preserving explicit values and inherited-name fields", () => {
    const input = {
      type: "object",
      additionalProperties: false,
      properties: {
        settings: {
          type: "object",
          additionalProperties: false,
          default: { size: 2, enabled: true },
          properties: { size: { type: "integer" }, enabled: { type: "boolean" } },
        },
        toString: { type: "string", default: "label" },
      },
    }
    expect(bind(input, { settings: { size: 3 } }).inputs).toEqual({
      settings: { size: 3, enabled: true },
      toString: "label",
    })
    expect(bind(input, { settings: {} }).inputOrigins?.["/settings/enabled"]).toMatchObject({
      kind: "default",
      pointer: "/inputs/properties/settings/default/enabled",
    })
  })

  it("validates URI format", () => {
    const input = {
      type: "object",
      additionalProperties: false,
      properties: { url: { type: "string", format: "uri" } },
    }
    expect(() => bind(input, { url: "bad url" })).toThrow()
    expect(bind(input, { url: "https://example.invalid/" }).inputs).toEqual({
      url: "https://example.invalid/",
    })
  })
  it("deduplicates normalized defaults and rejects differing diamond bindings", async () => {
    const root = await fixture([
      { local: "./base.yaml" },
      { local: "./base.yaml", with: { title: "Journal", delivery: "local" } },
    ])
    await yaml(root, "base.yaml", { inputs: schema, policies: { strict: true } })
    const ok = await resolveWorkspace({ cwd: root })
    expect(ok.diagnostics).toEqual([])
    expect(ok.configs).toHaveLength(1)
    expect(ok.configs[0]?.references).toHaveLength(2)
    expect(ok.configs[0]?.inputs).toEqual({ title: "Journal", delivery: "local" })
    expect(ok.config).not.toHaveProperty("inputs")
    await yaml(root, "parent.yaml", {
      extends: [{ local: "./base.yaml", with: { title: "Different" } }],
    })
    await yaml(root, "astrail.yaml", {
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "test" },
      extends: ["./base.yaml", "./parent.yaml"],
    })
    const invalid = await resolveWorkspace({ cwd: root })
    expect(invalid.diagnostics.some((item) => item.code === "ASTR1117")).toBe(true)
    expect(invalid.configs.find((item) => item.declaresInputs)?.inputStatus).toBe("invalid")
  })
  it("forwards typed values with provenance without leaking parent inputs to siblings", async () => {
    const root = await fixture([{ local: "./parent.yaml", with: { title: "My site" } }])
    await yaml(root, "parent.yaml", {
      inputs: schema,
      extends: [{ local: "./child.yaml", with: { title: { $input: "title" } } }, "./sibling.yaml"],
    })
    await yaml(root, "child.yaml", { inputs: schema })
    await yaml(root, "sibling.yaml", { inputs: schema })
    const workspace = await resolveWorkspace({ cwd: root })
    expect(workspace.diagnostics).toEqual([])
    expect(workspace.configs[0]?.inputs?.title).toBe("My site")
    expect(workspace.configs[0]?.inputOrigins?.["/title"]).toMatchObject({
      kind: "forward",
      from: { kind: "with", pointer: "/extends/0/with/title" },
    })
    expect(workspace.configs[1]?.inputs?.title).toBe("Journal")
  })
  it("keeps ownership through alias changes but drops it when source changes", async () => {
    const root = await fixture(["./base.yaml"], {
      capabilities: { record: { exposeAs: "renamed" } },
    })
    await mkdir(join(root, "skill"))
    await writeFile(
      join(root, "skill/SKILL.md"),
      "---\nname: record\ndescription: record\n---\nRecord.",
    )
    await yaml(root, "base.yaml", {
      inputs: schema,
      capabilities: {
        record: {
          kind: "skill",
          identity: "test/record",
          source: { type: "config", path: "skill" },
        },
      },
      setup: { mode: "skill", skill: "test/record" },
    })
    const first = await resolveWorkspace({ cwd: root })
    expect(first.capabilities[0]?.configKey).toBe(first.configs[0]?.key)
    expect(first.configSetups[0]?.inputsDigest).toBe(first.configs[0]?.inputsDigest)
    const text = await readFile(join(root, "astrail.yaml"), "utf8")
    await writeFile(
      join(root, "astrail.yaml"),
      text.replace("exposeAs: renamed", "source: { type: workspace, path: skill }"),
    )
    expect((await resolveWorkspace({ cwd: root })).capabilities[0]?.configKey).toBeUndefined()
  })
  it("reports uncached remote inputs as pending and keeps source keys stable across parameter changes", async () => {
    const root = await fixture([
      { http: "https://example.invalid/config.yaml", with: { title: "a" } },
    ])
    const first = await resolveWorkspace({ cwd: root })
    expect(first.configs[0]?.inputStatus).toBe("pending")
    await yaml(root, "astrail.yaml", {
      apiVersion: "astrail.dev/v1alpha1",
      kind: "Workspace",
      metadata: { name: "test" },
      extends: [{ http: "https://example.invalid/config.yaml", with: { title: "b" } }],
    })
    expect((await resolveWorkspace({ cwd: root })).configs[0]?.key).toBe(first.configs[0]?.key)
  })
})
