import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const catalog = JSON.parse(readFileSync(new URL("../catalog.json", import.meta.url), "utf8"))
assert.equal(catalog.formatVersion, 1)
assert.deepEqual(
  catalog.templates,
  [],
  "Add CLI compatibility validation before publishing the first template",
)
console.log("Official template catalog validated (no templates published)")
