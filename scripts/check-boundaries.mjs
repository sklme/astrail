import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = new URL("..", import.meta.url).pathname
const violations = []

for (const file of walk(join(root, "packages"))) {
  if (!file.endsWith(".ts") || file.includes("/dist/")) continue
  const source = readFileSync(file, "utf8")
  for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1] ?? ""
    if (specifier.includes("/src/") || /\.\.\/\.\.\/[^/]+\/src/.test(specifier)) {
      violations.push(`${relative(root, file)} imports private source ${specifier}`)
    }
  }
}

if (violations.length) {
  process.stderr.write(`${violations.join("\n")}\n`)
  process.exitCode = 1
}

function* walk(path) {
  for (const entry of readdirSync(path)) {
    const child = join(path, entry)
    if (entry === "node_modules" || entry === "dist") continue
    if (statSync(child).isDirectory()) yield* walk(child)
    else yield child
  }
}
