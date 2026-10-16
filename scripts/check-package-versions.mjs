import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const packagesDirectory = fileURLToPath(new URL("../packages", import.meta.url))
const packages = readdirSync(packagesDirectory, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const path = join(packagesDirectory, entry.name, "package.json")
    const manifest = JSON.parse(readFileSync(path, "utf8"))
    return { path, name: manifest.name, version: manifest.version }
  })
  .filter((entry) => typeof entry.name === "string")
  .sort((left, right) => left.name.localeCompare(right.name))

if (packages.length === 0) {
  process.stderr.write("No workspace package manifests found under packages/.\n")
  process.exitCode = 1
} else {
  const expectedVersion = packages[0].version
  const misaligned = packages.filter((entry) => entry.version !== expectedVersion)

  if (typeof expectedVersion !== "string" || misaligned.length > 0) {
    process.stderr.write("Workspace package versions are not aligned:\n")
    for (const entry of packages) {
      process.stderr.write(`- ${entry.name}: ${String(entry.version)}\n`)
    }
    process.exitCode = 1
  } else {
    process.stdout.write(
      `Workspace package versions aligned at ${expectedVersion} (${packages.length} packages).\n`,
    )
  }
}
