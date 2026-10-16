import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import {
  checkArtifactSource,
  checkManifest,
  checkPublishedArtifact,
  compareVersions,
  parseVersion,
  promotion,
  verifyPackage,
} from "./npm-release.mjs"

test("stable and prerelease promotion cannot roll an existing tag backward", () => {
  assert.deepEqual(promotion("0.9.2", { latest: "0.9.1" }), { tag: "latest", update: true })
  assert.deepEqual(promotion("0.9.1", { latest: "0.10.0" }), { tag: "latest", update: false })
  assert.deepEqual(promotion("0.9.1", { latest: "0.9.1" }), { tag: "latest", update: false })
  assert.deepEqual(promotion("0.10.0-rc.1", { latest: "0.9.1", next: "0.10.0-rc.2" }), {
    tag: "next",
    update: false,
  })
  assert(compareVersions("0.10.0-rc.10", "0.10.0-rc.2") > 0)
  assert(compareVersions("0.10.0", "0.10.0-rc.10") > 0)
  for (const version of ["v0.9.1", "0.9.1;echo bad", "01.2.3", "1.2.3-rc.01", "1.2.3-rc..1"]) {
    assert.throws(() => parseVersion(version))
  }
})

test("verification accepts only the registry's exact package identity and archive bytes", () => {
  const bytes = Buffer.from("published archive")
  const manifest = {
    name: "astrail",
    version: "0.9.1",
    repository: { url: "git+https://github.com/sklme/astrail.git" },
    publishConfig: { registry: "https://registry.npmjs.org/" },
    dependencies: { "astrail-core": "0.9.1" },
    dist: {
      tarball: "https://registry.npmjs.org/astrail/-/astrail-0.9.1.tgz",
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    },
  }
  checkPublishedArtifact(manifest, bytes, "astrail", "0.9.1")
  assert.throws(() => checkPublishedArtifact(manifest, Buffer.from("changed"), "astrail", "0.9.1"))
  assert.throws(() => checkPublishedArtifact(manifest, bytes, "astrail-core", "0.9.1"))
  assert.throws(() => checkPublishedArtifact(manifest, bytes, "astrail", "0.9.2"))
  assert.throws(() =>
    checkPublishedArtifact(
      { ...manifest, dist: { ...manifest.dist, tarball: "https://example.invalid/archive.tgz" } },
      bytes,
      "astrail",
      "0.9.1",
    ),
  )
})

test("registry verification artifacts cannot be used to publish", () => {
  checkArtifactSource({ artifactSource: "registry" }, "verify")
  checkArtifactSource({ artifactSource: "build" }, "publish")
  assert.throws(() => checkArtifactSource({ artifactSource: "registry" }, "publish"))
  assert.throws(() => checkArtifactSource({ artifactSource: "build" }, "verify"))
  assert.throws(() => checkArtifactSource({}, "publish"))
  assert.throws(() => checkArtifactSource({ artifactSource: "build" }, "unknown"))
})

test("packed packages reject private identities and unresolved workspace dependencies", () => {
  const manifest = {
    name: "astrail",
    version: "0.9.1",
    repository: { url: "git+https://github.com/sklme/astrail.git" },
    publishConfig: { registry: "https://registry.npmjs.org/" },
    dependencies: { "astrail-core": "0.9.1" },
  }
  checkManifest(manifest, "astrail", "0.9.1")
  assert.throws(() => checkManifest({ ...manifest, private: true }, "astrail", "0.9.1"))
  assert.throws(() =>
    checkManifest(
      { ...manifest, dependencies: { "astrail-core": "workspace:*" } },
      "astrail",
      "0.9.1",
    ),
  )
  assert.throws(() =>
    checkManifest({ ...manifest, dependencies: { "astrail-core": "0.9.0" } }, "astrail", "0.9.1"),
  )
})

test("publication tolerates delayed indexing and archive propagation without republishing", async () => {
  const bytes = Buffer.from("published archive")
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
  const item = { name: "astrail-schema", integrity }
  let reads = 0
  let downloads = 0
  const waits = []
  await verifyPackage(item, "0.10.0", {
    metadata: async () => ({
      versions:
        ++reads < 13
          ? {}
          : {
              "0.10.0": {
                dist: {
                  integrity,
                  tarball: "https://registry.npmjs.org/astrail-schema/-/astrail-schema-0.10.0.tgz",
                },
              },
            },
    }),
    fetch: async () =>
      ++downloads === 1 ? { status: 404 } : { status: 200, arrayBuffer: async () => bytes },
    pause: async (ms) => {
      waits.push(ms)
    },
  })
  assert.equal(reads, 14)
  assert.equal(downloads, 2)
  assert.equal(waits.length, 13)
  assert(waits.every((ms) => ms === 5000))
  await assert.rejects(
    verifyPackage(item, "0.10.0", {
      metadata: async () => ({ versions: { "0.10.0": { dist: { integrity: "different" } } } }),
      pause: async () => {
        assert.fail("A digest conflict must fail immediately")
      },
    }),
    /Existing package differs/,
  )
  await assert.rejects(
    verifyPackage(item, "0.10.0", {
      metadata: async () => ({ versions: {} }),
      attempts: 2,
      pause: async () => {},
    }),
    /inspect before retrying/,
  )
})
