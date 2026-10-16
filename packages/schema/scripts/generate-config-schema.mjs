import { readFileSync, writeFileSync } from "node:fs"

// The effective Workspace is the single source of business fields and complete
// entity contracts. Authored configs may overlay entities provided by extends.
export function authoredSchemas(effective) {
  const workspace = structuredClone(effective)
  workspace.$id = "https://sklme.github.io/astrail/schema/workspace/v1alpha1.json"
  const atomic = new Set(["configReference", "configSetup", "identifier", "metadata"])
  function partial(value) {
    if (Array.isArray(value)) return value.map(partial)
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, child]) => key !== "required" || !Array.isArray(child))
        .map(([key, child]) => [
          key === "oneOf" ? "anyOf" : key,
          key === "if" ? child : partial(child),
        ]),
    )
  }
  for (const [key, definition] of Object.entries(workspace.$defs)) {
    if (!atomic.has(key)) workspace.$defs[key] = partial(definition)
  }
  const config = structuredClone(workspace)
  config.$id = "https://sklme.github.io/astrail/schema/config/v1alpha1.json"
  config.title = "Astrail Shared Config v1alpha1"
  delete config.required
  delete config.properties.runtime
  delete config.properties.kind
  config.$defs.metadata = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1 },
      description: { type: "string" },
      version: { type: "string" },
    },
  }
  return { workspace, config }
}

const root = new URL("../schema/", import.meta.url)
const effective = JSON.parse(
  readFileSync(new URL("effective-workspace-v1alpha1.schema.json", root)),
)
for (const [kind, schema] of Object.entries(authoredSchemas(effective))) {
  writeFileSync(
    new URL(`${kind}-v1alpha1.schema.json`, root),
    `${JSON.stringify(schema, null, 2)}\n`,
  )
}
