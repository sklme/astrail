import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const packages = [
  ["astrail-schema", "schema"],
  ["astrail-core", "core"],
  ["astrail-target-codex", "target-codex"],
  ["astrail", "cli"],
  ["astrail-templates", "templates"],
]
const registry = "https://registry.npmjs.org/"
const site = "https://sklme.github.io/astrail/"
const root = fileURLToPath(new URL("..", import.meta.url))
const json = (path) => JSON.parse(readFileSync(path, "utf8"))
const save = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const hash = (bytes, algorithm = "sha512") =>
  `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`
const command = (name, args, options = {}) =>
  execFileSync(name, args, { stdio: "inherit", cwd: root, ...options })
const pause = (ms) => new Promise((done) => setTimeout(done, ms))

export function parseVersion(version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\w.-]+))?$/)
  const [base, ...suffix] = version.split("-")
  const prerelease = suffix.length ? suffix.join("-").split(".") : []
  for (const item of prerelease) {
    assert(/^[A-Za-z0-9-]+$/.test(item) && !/^0\d+$/.test(item), "Invalid prerelease")
  }
  return { base: base.split(".").map(BigInt), prerelease }
}

export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  for (let i = 0; i < 3; i++) {
    if (left.base[i] !== right.base[i]) return left.base[i] > right.base[i] ? 1 : -1
  }
  if (!left.prerelease.length || !right.prerelease.length) {
    return Number(!left.prerelease.length) - Number(!right.prerelease.length)
  }
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i++) {
    const x = left.prerelease[i]
    const y = right.prerelease[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    const nx = /^\d+$/.test(x)
    const ny = /^\d+$/.test(y)
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1
    if (nx !== ny) return nx ? -1 : 1
    return x > y ? 1 : -1
  }
  return 0
}

export function promotion(version, tags) {
  const tag = parseVersion(version).prerelease.length ? "next" : "latest"
  return { tag, update: !tags[tag] || compareVersions(version, tags[tag]) > 0 }
}

export function checkManifest(manifest, name, version) {
  assert.equal(manifest.name, name)
  assert.equal(manifest.version, version)
  assert(!manifest.private)
  assert.equal(manifest.repository.url, "git+https://github.com/sklme/astrail.git")
  assert.equal(manifest.publishConfig.registry, registry)
  for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
    assert(!/^(workspace:|file:|link:)/.test(range), `Unresolved dependency: ${dependency}`)
    if (packages.some(([item]) => item === dependency)) assert.equal(range, version)
  }
}

export function checkPublishedArtifact(manifest, bytes, name, version) {
  checkManifest(manifest, name, version)
  assert.equal(new URL(manifest.dist.tarball).origin, new URL(registry).origin)
  assert.equal(hash(bytes), manifest.dist.integrity, `Registry archive differs: ${name}`)
}

export function checkArtifactSource(manifest, operation) {
  assert(["verify", "publish"].includes(operation))
  assert.equal(manifest.artifactSource, operation === "verify" ? "registry" : "build")
}

async function prepare(version, directory, operation) {
  parseVersion(version)
  assert(["verify", "publish"].includes(operation))
  mkdirSync(directory, { recursive: true })
  const release = {
    version,
    artifactSource: operation === "verify" ? "registry" : "build",
    commit: command("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: "pipe" }).trim(),
    packages: [],
  }
  for (const [name, folder] of packages) {
    const filename = `${name}-${version}.tgz`
    const path = join(directory, filename)
    if (operation === "verify") {
      const published = (await metadata(name)).versions[version]
      assert(published, `Verification requires an existing ${name}@${version}`)
      assert.equal(new URL(published.dist.tarball).origin, new URL(registry).origin)
      const response = await fetch(published.dist.tarball, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      })
      assert.equal(response.status, 200)
      const bytes = Buffer.from(await response.arrayBuffer())
      checkPublishedArtifact(published, bytes, name, version)
      writeFileSync(path, bytes)
    } else {
      const source = json(join(root, "packages", folder, "package.json"))
      assert.equal(source.version, version, name)
      command("pnpm", ["--dir", `packages/${folder}`, "pack", "--out", path])
    }
    const listing = command("tar", ["-tzf", path], { encoding: "utf8", stdio: "pipe" })
      .trim()
      .split("\n")
    assert(listing.every((file) => file.startsWith("package/") && !file.split("/").includes("..")))
    assert(
      !listing.some((file) => /(?:\.test\.|\.tsbuildinfo$|node_modules\/|\.npmrc$)/.test(file)),
    )
    const details = command("tar", ["-tvzf", path], { encoding: "utf8", stdio: "pipe" })
    assert(!details.split("\n").some((line) => /^[lh]/.test(line)), "Archive contains links")
    const manifest = JSON.parse(
      command("tar", ["-xOf", path, "package/package.json"], { encoding: "utf8", stdio: "pipe" }),
    )
    checkManifest(manifest, name, version)
    release.packages.push({
      name,
      filename,
      integrity: hash(readFileSync(path)),
      files: listing.length,
    })
  }
  save(join(directory, "manifest.json"), release)
}

async function metadata(name) {
  const response = await fetch(`${registry}${name}`, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(30000),
  })
  if (response.status === 404) return { versions: {}, "dist-tags": {} }
  assert.equal(response.status, 200, `Registry returned ${response.status} for ${name}`)
  return response.json()
}

export async function verifyPackage(item, version, dependencies = {}) {
  const readMetadata = dependencies.metadata ?? metadata
  const download = dependencies.fetch ?? fetch
  const wait = dependencies.pause ?? pause
  const attempts = dependencies.attempts ?? 60
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = (await readMetadata(item.name)).versions[version]
    if (current) {
      assert.equal(
        current.dist.integrity,
        item.integrity,
        `Existing package differs: ${item.name}@${version}`,
      )
      assert.equal(new URL(current.dist.tarball).origin, new URL(registry).origin)
      const response = await download(current.dist.tarball, { signal: AbortSignal.timeout(30000) })
      if (response.status !== 404) {
        assert.equal(response.status, 200)
        assert.equal(hash(Buffer.from(await response.arrayBuffer())), item.integrity)
        return
      }
    }
    if (attempt + 1 < attempts) await wait(5000)
  }
  throw new Error(`Registry did not expose ${item.name}@${version}; inspect before retrying`)
}

async function verifyResources(version) {
  const release = json(join(root, "public-resources/release-manifest.json")).releases.find(
    (item) => item.version === version,
  )
  assert(release, "Commit and deploy fixed resources before publishing")
  for (const resource of [...release.schemas, ...release.templates, ...release.configs]) {
    assert.equal(resource.url, new URL(resource.path, site).href)
    const response = await fetch(resource.url, { signal: AbortSignal.timeout(30000) })
    assert.equal(response.status, 200, resource.url)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(createHash("sha256").update(bytes).digest("hex"), resource.sha256)
  }
}

function smoke(version) {
  const directory = mkdtempSync(join(tmpdir(), "astrail-npm-smoke-"))
  const launcher = join(directory, "launcher")
  const workspace = join(directory, "workspace")
  mkdirSync(launcher)
  mkdirSync(workspace)
  const userconfig = join(directory, "empty.npmrc")
  writeFileSync(userconfig, "")
  const env = {
    ...process.env,
    NPM_CONFIG_USERCONFIG: userconfig,
    NPM_CONFIG_REGISTRY: registry,
    NPM_CONFIG_CACHE: join(directory, "cache"),
  }
  const install = ["install", "--ignore-scripts", "--no-audit", "--no-fund"]
  save(join(launcher, "package.json"), { private: true })
  command("npm", [...install, `astrail@${version}`, `astrail-templates@${version}`], {
    cwd: launcher,
    env,
  })
  const entry = join(launcher, "node_modules/astrail/dist/index.js")
  command(process.execPath, [entry, "init", "--name", "public-release-smoke", "--skip-install"], {
    cwd: workspace,
    env,
    stdio: "pipe",
  })
  assert.equal(json(join(workspace, "package.json")).devDependencies.astrail, `~${version}`)
  command("npm", [...install, "--save-dev", "--save-exact", `astrail@${version}`], {
    cwd: workspace,
    env,
  })
  for (const args of [
    ["validate"],
    ["bootstrap", "--dry-run"],
    ["bootstrap", "--yes"],
    ["status"],
  ]) {
    const result = JSON.parse(
      command(process.execPath, [entry, "--json", ...args], {
        cwd: workspace,
        env,
        stdio: "pipe",
        encoding: "utf8",
      }),
    )
    assert.equal(result.success, true, args.join(" "))
    if (args[0] === "status") {
      assert.equal(result.data.runtime.version, version)
      assert.equal(result.data.codex.current, true)
      const expectedSkills = [
        "astrail-editor",
        "astrail-environments",
        "astrail-inspection",
        "astrail-repositories",
        "astrail-skills",
      ]
      if (compareVersions(version, "0.11.0") < 0) expectedSkills.push("astrail-records")
      assert.deepEqual(
        result.data.codex.artifacts
          .filter((item) => item.path.startsWith(".agents/skills/"))
          .map((item) => item.path.slice(".agents/skills/".length))
          .sort(),
        expectedSkills.sort(),
      )
      if (compareVersions(version, "0.11.0") >= 0) {
        const guidance = readFileSync(join(workspace, "AGENTS.md"), "utf8")
        assert(!guidance.includes("$astrail-records"))
        assert(!guidance.includes("Task records and durable knowledge"))
      }
    }
  }
  assert(existsSync(join(workspace, "public-release-smoke.code-workspace")))
}

async function run(version, directory, operation) {
  assert(["verify", "publish"].includes(operation))
  assert.equal(process.env.GITHUB_REPOSITORY, "sklme/astrail")
  assert.equal(process.env.GITHUB_REF, "refs/heads/main")
  assert(
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    "OIDC is required",
  )
  assert(!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN, "Use OIDC, not a stored npm token")
  const manifest = json(join(directory, "manifest.json"))
  checkArtifactSource(manifest, operation)
  assert.equal(manifest.version, version)
  assert.equal(manifest.commit, process.env.GITHUB_SHA)
  assert.deepEqual(
    manifest.packages.map((item) => item.name),
    packages.map(([name]) => name),
  )
  const result = {
    version,
    operation,
    artifactSource: manifest.artifactSource,
    commit: manifest.commit,
    packages: [],
    success: false,
  }
  const resultPath = join(directory, "result.json")
  const npm = (args) => command("npm", [...args, `--registry=${registry}`, "--ignore-scripts"])
  try {
    await verifyResources(version)
    // Inspect all existing versions before performing any publication.
    for (const item of manifest.packages) {
      assert.equal(item.filename, `${item.name}-${version}.tgz`)
      assert.equal(hash(readFileSync(join(directory, item.filename))), item.integrity)
      const current = (await metadata(item.name)).versions[version]
      if (current)
        assert.equal(current.dist.integrity, item.integrity, `Version conflict: ${item.name}`)
      else
        assert.equal(
          operation,
          "publish",
          `Verification requires an existing ${item.name}@${version}`,
        )
    }
    for (const item of manifest.packages) {
      const entry = {
        name: item.name,
        integrity: item.integrity,
        submitted: false,
        verified: false,
      }
      result.packages.push(entry)
      if (operation === "publish" && !(await metadata(item.name)).versions[version]) {
        npm(["publish", join(directory, item.filename), "--access=public", "--tag=candidate"])
        entry.submitted = true
        save(resultPath, result)
      }
      await verifyPackage(item, version)
      entry.verified = true
      save(resultPath, result)
    }
    smoke(version)
    for (const item of manifest.packages) {
      const before = (await metadata(item.name))["dist-tags"]
      let expected
      if (operation === "verify") {
        const tag = `oidc-check-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`
        assert(!before[tag], "Verification tag already exists")
        try {
          npm(["dist-tag", "add", `${item.name}@${version}`, tag])
        } finally {
          npm(["dist-tag", "rm", item.name, tag])
        }
        expected = before
      } else {
        const { tag, update } = promotion(version, before)
        if (update) npm(["dist-tag", "add", `${item.name}@${version}`, tag])
        else console.log(`${item.name}: keeping existing ${tag}; never roll a tag backward`)
        expected = { ...before, ...(update ? { [tag]: version } : {}) }
      }
      let actual
      for (let attempt = 0; attempt < 10; attempt++) {
        actual = (await metadata(item.name))["dist-tags"]
        if (Object.keys({ ...actual, ...expected }).every((tag) => actual[tag] === expected[tag]))
          break
        await pause(3000)
      }
      assert.deepEqual(actual, expected, `Registry tags differ: ${item.name}`)
      result.packages.find((entry) => entry.name === item.name).tags = actual
      save(resultPath, result)
    }
    result.success = true
  } finally {
    save(resultPath, result)
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Astrail ${version}: ${operation} ${result.success ? "succeeded" : "failed"}.\n\nValidated ${result.packages.length} packages. See result.json for digests.\n`,
        { flag: "a" },
      )
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.env.RELEASE_VERSION
  parseVersion(version)
  const directory = resolve(process.env.RELEASE_DIRECTORY)
  if (process.argv[2] === "prepare")
    await prepare(version, directory, process.env.RELEASE_OPERATION)
  else if (process.argv[2] === "run") await run(version, directory, process.env.RELEASE_OPERATION)
  else throw new Error("Expected prepare or run")
}
