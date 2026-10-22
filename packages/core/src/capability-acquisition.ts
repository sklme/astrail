import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import type { GitCapabilitySource } from "astrail-schema"
import { capabilityIntegrity } from "./capability.js"
import { pathExists } from "./fs.js"
import { cloneRepository } from "./git.js"
import { journalStep } from "./journal-trace.js"
import { runProcess } from "./process.js"
import type { ResolvedCapability } from "./types.js"

export interface StagedGitCapability {
  stagingRoot: string
  path: string
  source: GitCapabilitySource
  resolvedCommit: string
  integrity: string
  cleanup(): Promise<void>
}

export interface GitCapabilityResolution {
  capabilityId: string
  source: GitCapabilitySource
  resolvedCommit: string
  integrity: string
}

export async function stageGitCapability(
  capability: ResolvedCapability,
  options: { temporaryRoot?: string } = {},
): Promise<StagedGitCapability> {
  return journalStep("skill.acquire", () => stageGitCapabilityObserved(capability, options), {
    target: capability.identity,
  })
}

async function stageGitCapabilityObserved(
  capability: ResolvedCapability,
  options: { temporaryRoot?: string } = {},
): Promise<StagedGitCapability> {
  if (capability.source.type !== "git") {
    throw new Error(`Capability ${capability.identity} is not backed by Git`)
  }
  const temporaryRoot = options.temporaryRoot ?? tmpdir()
  await mkdir(temporaryRoot, { recursive: true })
  const stagingRoot = await mkdtemp(join(temporaryRoot, "astrail-capability-"))
  const checkoutRoot = join(stagingRoot, "checkout")
  try {
    validateRelativeContentPath(capability.source.path)
    await cloneRepository(
      capability.source.url,
      checkoutRoot,
      capability.lockedCommit ? { commit: capability.lockedCommit } : capability.source.revision,
    )
    const selectedPath = await containedRealPath(checkoutRoot, capability.source.path)
    if (capability.kind === "skill" && !(await pathExists(join(selectedPath, "SKILL.md")))) {
      throw new Error(
        `Git Skill ${capability.identity} does not contain SKILL.md at ${capability.source.path}`,
      )
    }
    const revision = await runProcess("git", ["-C", checkoutRoot, "rev-parse", "HEAD"])
    if (revision.exitCode !== 0 || !revision.stdout.trim()) {
      throw new Error(
        `Cannot resolve Git commit for ${capability.identity}: ${revision.stderr.trim()}`,
      )
    }
    const integrity = await capabilityIntegrity(selectedPath)
    if (!integrity) throw new Error(`Cannot calculate integrity for ${capability.identity}`)
    let cleaned = false
    return {
      stagingRoot,
      path: selectedPath,
      source: structuredClone(capability.source),
      resolvedCommit: revision.stdout.trim(),
      integrity,
      async cleanup() {
        if (cleaned) return
        cleaned = true
        await rm(stagingRoot, { recursive: true, force: true })
      },
    }
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

function validateRelativeContentPath(path: string): void {
  if (!path || isAbsolute(path) || path.includes("\\")) {
    throw new Error(`Git capability content path must be repository-relative: ${path}`)
  }
  const normalized = relative(".", resolve(".", path))
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error(`Git capability content path escapes its checkout: ${path}`)
  }
}

async function containedRealPath(checkoutRoot: string, contentPath: string): Promise<string> {
  const checkout = await realpath(checkoutRoot)
  const selected = await realpath(resolve(checkoutRoot, contentPath)).catch(() => undefined)
  if (!selected) throw new Error(`Git capability content path is unavailable: ${contentPath}`)
  const fromCheckout = relative(checkout, selected)
  if (fromCheckout === ".." || fromCheckout.startsWith(`..${sep}`) || isAbsolute(fromCheckout)) {
    throw new Error(`Git capability content path escapes its checkout: ${contentPath}`)
  }
  return selected
}
