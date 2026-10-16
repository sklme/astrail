import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { checkPublicResources } from "./check-public-resources.mjs"

test("resource validation rejects tampering, removed history, stale aliases and rollback", (t) => {
  const root = mkdtempSync(join(tmpdir(), "astrail-resource-check-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const save = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value))
  }
  const bytes = JSON.stringify({
    $id: "https://sklme.github.io/astrail/schema/workspace/v1alpha1.json",
  })
  const path = "schema/1.0.0/workspace-v1alpha1.json"
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const entry = {
    category: "schema",
    version: "1.0.0",
    kind: "workspace",
    protocol: "v1alpha1",
    path,
    url: `https://sklme.github.io/astrail/${path}`,
    sha256,
    cliRange: "~1.0.0",
  }
  const integrity = { formatVersion: 1, files: { [path]: sha256 } }
  const manifest = {
    formatVersion: 1,
    current: "1.0.0",
    releases: [
      {
        version: "1.0.0",
        sourceCommit: "a".repeat(40),
        schemas: [entry],
        templates: [],
        configs: [],
      },
    ],
  }
  save("index.html", "Resources")
  save(path, bytes)
  save("schema/workspace/v1alpha1.json", bytes)
  save("resource-integrity.json", integrity)
  save("release-manifest.json", manifest)
  save("schema/index.json", { formatVersion: 1, current: "1.0.0", schemas: [entry] })
  save("templates/index.json", { formatVersion: 1, current: "1.0.0", packages: [], templates: [] })
  save("configs/index.json", { formatVersion: 1, current: "1.0.0", configs: [] })
  assert.equal(checkPublicResources(root).immutableFiles, 1)
  save(path, "tampered")
  assert.throws(() => checkPublicResources(root), /Resource changed/)
  save(path, bytes)
  save("schema/workspace/v1alpha1.json", "stale")
  assert.throws(() => checkPublicResources(root), /Stale alias/)
  save("schema/workspace/v1alpha1.json", bytes)
  assert.throws(
    () =>
      checkPublicResources(root, {
        integrity: { files: { "schema/0.9.0/workspace-v1alpha1.json": sha256 } },
      }),
    /Immutable resource/,
  )
  assert.throws(
    () =>
      checkPublicResources(root, {
        manifest: { releases: [], current: "1.1.0" },
      }),
    /rolled backward/,
  )
  assert.doesNotThrow(() => checkPublicResources(root, { integrity, manifest }))
})
