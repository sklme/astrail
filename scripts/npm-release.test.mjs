import assert from "node:assert/strict"
import test from "node:test"
import { checkManifest, compareVersions, parseVersion, promotion } from "./npm-release.mjs"

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
