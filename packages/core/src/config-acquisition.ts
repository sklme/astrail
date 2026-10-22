import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
  assertConfigContained,
  configCacheRoot,
  configIntegrity,
  configKey,
  downloadHttpConfig,
  normalizeConfigReference,
} from "./config-source.js"
import { atomicWrite, pathExists } from "./fs.js"
import { cloneRepository, inspectRepository } from "./git.js"
import { journalBeforeMutation, journalChange, journalStep } from "./journal-trace.js"
import { parseConfigText, validateGitConfigResources } from "./manifest.js"
import { runProcess } from "./process.js"
import { inspectAstrailRequirement } from "./runtime-requirements.js"
import { type Diagnostic, diagnostic, type LoadedConfig } from "./types.js"

export async function isFixedConfigReference(root: string, config: LoadedConfig): Promise<boolean> {
  if (config.source.type !== "git" || !config.source.ref) return false
  const ref = config.source.ref
  if (/^[0-9a-f]{40,64}$/i.test(ref) || ref.startsWith("refs/tags/")) return true
  return (
    (
      await runProcess("git", [
        "-C",
        configCacheRoot(root, config.source),
        "show-ref",
        "--verify",
        "--quiet",
        `refs/tags/${ref}`,
      ])
    ).exitCode === 0
  )
}

export async function acquireConfigs(
  root: string,
  configs: LoadedConfig[],
  runtimeVersion: string,
  options: { refresh?: boolean; lockedCommit?: string } = {},
): Promise<Diagnostic[]> {
  return journalStep(
    "config.acquire",
    () => acquireConfigsObserved(root, configs, runtimeVersion, options),
    { target: configs[0]?.key, outcome: (diagnostics) => ({ diagnostics }) },
  )
}

async function acquireConfigsObserved(
  root: string,
  configs: LoadedConfig[],
  runtimeVersion: string,
  options: { refresh?: boolean; lockedCommit?: string },
): Promise<Diagnostic[]> {
  const first = configs[0]
  if (!first || first.source.type === "local") return []
  const diagnostics: Diagnostic[] = []
  const names = new Map<string, string>()
  const validate = async (text: string, config: LoadedConfig, path: string): Promise<boolean> => {
    const parsed = parseConfigText(text, path, config.source.type === "http")
    const metadata = parsed.value.metadata
    if (
      metadata &&
      typeof metadata === "object" &&
      "name" in metadata &&
      typeof metadata.name === "string"
    )
      names.set(config.key, metadata.name)
    diagnostics.push(
      ...parsed.diagnostics,
      ...inspectAstrailRequirement(parsed.value, path, runtimeVersion, parsed.locations)
        .diagnostics,
    )
    if (config.source.type === "git")
      await validateGitConfigResources(
        parsed.value,
        path,
        dirnameOfCheckout(path, config.source.path),
      )
    const integrity = configIntegrity(text)
    if (config.expectedIntegrity && config.expectedIntegrity !== integrity)
      diagnostics.push(
        diagnostic("ASTR1104", "error", "Config integrity does not match the expected digest"),
      )
    return !diagnostics.some((item) => item.severity === "error")
  }
  let temporary: string | undefined
  try {
    if (first.source.type === "http") {
      const text = await downloadHttpConfig(first.source.url)
      if (!(await validate(text, first, first.source.url))) return diagnostics
      await atomicWrite(first.manifestPath, text)
      journalChange({
        kind: "config",
        target: first.key,
        action: "download",
        after: {
          ...(names.has(first.key) ? { identity: names.get(first.key) ?? first.key } : {}),
          integrity: configIntegrity(text),
        },
      })
    } else {
      const destination = configCacheRoot(root, first.source)
      if (!options.refresh && (await pathExists(destination))) return diagnostics
      await mkdir(dirname(destination), { recursive: true })
      temporary = await mkdtemp(join(dirname(destination), ".config-"))
      const checkout = join(temporary, "repo")
      const expectedCommits = new Set(
        configs.flatMap((item) => (item.expectedCommit ? [item.expectedCommit] : [])),
      )
      if (expectedCommits.size > 1)
        throw new Error("Config locks require different commits for the same checkout")
      await cloneRepository(first.source.url, checkout)
      // Tags and commits remain fixed even when a remote tag is moved. Branches
      // and an omitted ref are resolved again only during an explicit update.
      const ref = first.source.ref
      const isTag = ref
        ? (
            await runProcess("git", [
              "-C",
              checkout,
              "show-ref",
              "--verify",
              "--quiet",
              ref.startsWith("refs/tags/") ? ref : `refs/tags/${ref}`,
            ])
          ).exitCode === 0
        : false
      const fixed = ref && (isTag || /^[0-9a-f]{40,64}$/i.test(ref))
      const revision =
        first.expectedCommit ??
        [...expectedCommits][0] ??
        (options.refresh && fixed ? (options.lockedCommit ?? first.resolvedCommit) : undefined) ??
        ref
      if (revision) {
        let resolved = await runProcess("git", [
          "-C",
          checkout,
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${revision}^{commit}`,
        ])
        if (resolved.exitCode !== 0 && !expectedCommits.size)
          resolved = await runProcess("git", [
            "-C",
            checkout,
            "rev-parse",
            "--verify",
            "--end-of-options",
            `refs/remotes/origin/${revision}^{commit}`,
          ])
        if (resolved.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(resolved.stdout.trim()))
          throw new Error("Cannot resolve the requested Git ref or locked commit")
        const selected = await runProcess("git", [
          "-C",
          checkout,
          "checkout",
          "--detach",
          resolved.stdout.trim(),
        ])
        if (selected.exitCode !== 0) throw new Error("Config checkout failed")
      }
      const observed = await inspectRepository(checkout)
      const visiting = new Set<string>()
      const validated = new Set<string>()
      const validateTree = async (config: LoadedConfig): Promise<boolean> => {
        if (config.source.type !== "git") return true
        if (visiting.has(config.key)) throw new Error("Config reference cycle inside Git checkout")
        if (validated.has(config.key)) return true
        if (visiting.size >= 64 || validated.size >= 512)
          throw new Error("Config graph exceeds the depth or size limit")
        const path = join(checkout, config.source.path)
        await assertConfigContained(checkout, path)
        if (config.expectedCommit && config.expectedCommit !== observed.revision)
          throw new Error("Config commit differs from lock")
        const text = await readFile(path, "utf8")
        if (!(await validate(text, config, path))) return false
        visiting.add(config.key)
        const parsed = parseConfigText(text, path).value
        for (const reference of Array.isArray(parsed.extends) ? parsed.extends : []) {
          const dependency = await normalizeConfigReference(reference, path, config.source)
          if (
            dependency.source.type !== "git" ||
            dependency.source.url !== config.source.url ||
            dependency.source.ref !== config.source.ref
          )
            continue
          const key = configKey(dependency.source)
          const known = configs.find((item) => item.key === key)
          if (
            !(await validateTree(
              known ?? {
                key,
                source: dependency.source,
                manifestPath: path,
                available: false,
                ...(dependency.integrity ? { expectedIntegrity: dependency.integrity } : {}),
              },
            ))
          )
            return false
        }
        visiting.delete(config.key)
        validated.add(config.key)
        return true
      }
      for (const config of configs) if (!(await validateTree(config))) return diagnostics
      await journalBeforeMutation()
      const previous = join(temporary, "previous")
      const replacing = await pathExists(destination)
      if (replacing) await rename(destination, previous)
      try {
        await rename(checkout, destination)
      } catch (error) {
        if (replacing) await rename(previous, destination)
        throw error
      }
      journalChange({
        kind: "config",
        target: first.key,
        action: replacing ? "refresh" : "clone",
        ...(first.resolvedCommit ? { before: { revision: first.resolvedCommit } } : {}),
        after: {
          ...(names.has(first.key) ? { identity: names.get(first.key) ?? first.key } : {}),
          revision: observed.revision ?? null,
        },
      })
    }
  } catch (error) {
    diagnostics.push(
      diagnostic(
        "ASTR6106",
        "error",
        `Config acquisition failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          remediation:
            "Check the source, ref, config path, YAML, runtime requirement and integrity, then retry install.",
        },
      ),
    )
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
  return diagnostics
}

function dirnameOfCheckout(file: string, relativePath: string): string {
  let root = file
  for (const _ of relativePath.split("/")) root = dirname(root)
  return root
}
