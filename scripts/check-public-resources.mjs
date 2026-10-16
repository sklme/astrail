import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const site = "https://sklme.github.io/astrail/"
const versioned = /^(schema|templates|configs)\/\d+\.\d+\.\d+(?:-[\w.-]+)?\//
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const json = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"))

export function checkPublicResources(root, previous = {}) {
  const integrity = json(root, "resource-integrity.json")
  const manifest = json(root, "release-manifest.json")
  assert.equal(integrity.formatVersion, 1)
  assert.equal(manifest.formatVersion, 1)
  assert(Array.isArray(manifest.releases))
  const paths = []
  function walk(path = "") {
    for (const name of readdirSync(join(root, path))) {
      const child = path ? `${path}/${name}` : name
      const stat = lstatSync(join(root, child))
      assert(!stat.isSymbolicLink(), `Resource symlink: ${child}`)
      if (stat.isDirectory()) walk(child)
      else paths.push(child)
    }
  }
  walk()
  assert(paths.includes("index.html"))
  for (const [path, expected] of Object.entries(integrity.files)) {
    assert(versioned.test(path) && !path.split("/").includes(".."), `Invalid path: ${path}`)
    assert.match(expected, /^[a-f0-9]{64}$/)
    assert.equal(digest(readFileSync(join(root, path))), expected, `Resource changed: ${path}`)
  }
  for (const path of paths.filter((path) => versioned.test(path))) {
    assert(Object.hasOwn(integrity.files, path), `Untracked resource: ${path}`)
  }
  const versions = new Set()
  const entries = []
  for (const release of manifest.releases) {
    assert.match(release.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/)
    assert(!versions.has(release.version), `Duplicate release: ${release.version}`)
    versions.add(release.version)
    assert.match(release.sourceCommit, /^[a-f0-9]{40}$/)
    for (const entry of [...release.schemas, ...release.templates, ...release.configs]) {
      assert.equal(entry.version, release.version)
      assert(entry.path.startsWith(`${entry.category}/${release.version}/`))
      assert.equal(entry.url, new URL(entry.path, site).href)
      assert.equal(entry.sha256, integrity.files[entry.path])
      assert.equal(entry.cliRange, `~${release.version}`)
      entries.push(entry)
    }
    for (const entry of release.schemas) {
      assert.equal(entry.category, "schema")
      const schema = json(root, entry.path)
      assert.equal(schema.$id, `${site}schema/${entry.kind}/${entry.protocol}.json`)
    }
  }
  assert.deepEqual(
    [...new Set(entries.map((entry) => entry.path))].sort(),
    Object.keys(integrity.files).sort(),
  )
  for (const [category, key] of [
    ["schema", "schemas"],
    ["templates", "packages"],
    ["configs", "configs"],
  ]) {
    const catalog = json(root, `${category}/index.json`)
    assert.equal(catalog.formatVersion, 1)
    assert.equal(catalog.current, manifest.current)
    assert.deepEqual(
      catalog[key],
      entries.filter((entry) => entry.category === category),
    )
    if (category === "templates") assert.deepEqual(catalog.templates, [])
  }
  if (manifest.current !== null) {
    assert.match(manifest.current, /^\d+\.\d+\.\d+$/)
    const current = manifest.releases.find((release) => release.version === manifest.current)
    assert(current, "Stable release missing")
    for (const entry of current.schemas) {
      const alias = `schema/${entry.kind}/${entry.protocol}.json`
      assert.equal(digest(readFileSync(join(root, alias))), entry.sha256, `Stale alias: ${alias}`)
    }
  }
  for (const [path, expected] of Object.entries(previous.integrity?.files ?? {})) {
    assert.equal(integrity.files[path], expected, `Immutable resource replaced or removed: ${path}`)
  }
  for (const release of previous.manifest?.releases ?? []) {
    assert.deepEqual(
      manifest.releases.find((item) => item.version === release.version),
      release,
    )
  }
  const before = previous.manifest?.current
  if (before) {
    assert(manifest.current, "Stable entry removed")
    const a = manifest.current.split(".").map(Number)
    const b = before.split(".").map(Number)
    const first = a.findIndex((value, index) => value !== b[index])
    assert(first === -1 || a[first] > b[first], "Stable entry rolled backward")
  }
  return {
    releases: manifest.releases.length,
    immutableFiles: entries.length,
    current: manifest.current,
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const previous = {}
  const base = process.env.ASTRAIL_RESOURCE_BASE
  if (base && !/^0+$/.test(base)) {
    // A missing file is valid for the initial resource release; a missing revision is not.
    execFileSync("git", ["rev-parse", "--verify", `${base}^{commit}`], { stdio: "pipe" })
    for (const [key, name] of [
      ["integrity", "resource-integrity.json"],
      ["manifest", "release-manifest.json"],
    ]) {
      const path = `public-resources/${name}`
      if (execFileSync("git", ["ls-tree", base, "--", path], { encoding: "utf8" }).trim()) {
        previous[key] = JSON.parse(
          execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8" }),
        )
      }
    }
  }
  console.log(
    checkPublicResources(fileURLToPath(new URL("../public-resources", import.meta.url)), previous),
  )
}
