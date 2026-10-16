import { describe, expect, it } from "vitest"
import { composeLayers, explainProvenance } from "./composition.js"
import type { ConfigLayer } from "./types.js"

describe("configuration composition", () => {
  it("treats prototype-shaped keys as data across shared layers", () => {
    const composed = composeLayers([
      layer("base", "config", 1, { extensions: { vendor: {} } }),
      layer(
        "override",
        "config",
        2,
        JSON.parse('{"extensions":{"vendor":{"__proto__":{"astrailPolluted":true}}}}'),
      ),
    ])
    expect(Object.prototype).not.toHaveProperty("astrailPolluted")
    expect(JSON.stringify(composed.value)).toContain('"__proto__":{"astrailPolluted":true}')
  })
  it("merges entities by stable key, replaces arrays, and records overrides", () => {
    const layers: ConfigLayer[] = [
      layer("config", "config", 1, {
        repositories: {
          api: {
            access: "read-only",
            source: { type: "local", path: "repos/api" },
            role: "backend",
            exports: { contexts: ["base"] },
          },
        },
        contexts: { guide: { kind: "file", path: "base.md" } },
      }),
      layer("workspace", "shared", 2, {
        repositories: { api: { access: "read-write", exports: { contexts: ["contract"] } } },
        contexts: { guide: { kind: "file", path: "workspace.md" } },
      }),
      layer("local", "local", 3, {
        repositories: { api: { source: { path: "../api" } } },
      }),
    ]
    const composed = composeLayers(layers)
    expect(composed.value.repositories).toEqual({
      api: {
        access: "read-write",
        source: { type: "local", path: "../api" },
        role: "backend",
        exports: { contexts: ["contract"] },
      },
    })
    expect(composed.value.contexts).toEqual({
      guide: { kind: "file", path: "workspace.md" },
    })
    expect(
      explainProvenance(composed.provenance, "repositories.api.source.path").map(
        (item) => item.layer,
      ),
    ).toEqual(["config", "local"])
  })
})

function layer(
  id: string,
  kind: ConfigLayer["kind"],
  order: number,
  value: Record<string, unknown>,
): ConfigLayer {
  return { id, kind, order, source: `${id}.yaml`, value, locations: {} }
}
