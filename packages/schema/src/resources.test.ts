import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  configSchema,
  effectiveWorkspaceSchema,
  localSchema,
  lockSchema,
  workspaceSchema,
} from "./index.js"

describe("published Schema resources", () => {
  it("uses identical business fields for Workspace and shared fragments", () => {
    const { kind, metadata, runtime, ...workspaceFields } = workspaceSchema.properties as Record<
      string,
      unknown
    >
    const { metadata: configMetadata, ...configFields } = configSchema.properties as Record<
      string,
      unknown
    >
    expect(kind).toEqual({ const: "Workspace" })
    expect(runtime).toEqual((localSchema.properties as Record<string, unknown>).runtime)
    expect((configSchema.properties as Record<string, unknown>).runtime).toBeUndefined()
    expect(metadata).toEqual(configMetadata)
    expect(configFields).toEqual(workspaceFields)
    expect(configSchema.required).toBeUndefined()
    expect(workspaceSchema.required).toEqual(effectiveWorkspaceSchema.required)
    expect(configSchema.$id).not.toEqual(workspaceSchema.$id)
  })
  it("keeps the resource catalog, public exports and canonical download URLs consistent", () => {
    const catalog = JSON.parse(readFileSync(new URL("../resources.json", import.meta.url), "utf8"))
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    const schemas = {
      config: configSchema,
      local: localSchema,
      lock: lockSchema,
      workspace: workspaceSchema,
    }
    expect(catalog.formatVersion).toBe(1)
    expect(catalog.schemas).toHaveLength(4)
    for (const entry of catalog.schemas) {
      const schema = schemas[entry.kind as keyof typeof schemas]
      expect(schema.$id).toBe(
        `https://sklme.github.io/astrail/schema/${entry.kind}/${entry.protocol}.json`,
      )
      const packed = JSON.parse(
        readFileSync(new URL(`../${manifest.exports[entry.export]}`, import.meta.url), "utf8"),
      )
      expect(packed).toEqual(schema)
    }
  })
})
