import { lstat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathExists } from "./fs.js"
import { runProcess } from "./process.js"
import type { RepositoryObservation } from "./types.js"

export async function inspectRepository(path: string): Promise<RepositoryObservation> {
  if (!(await pathExists(path))) return { present: false, isGitRepository: false }

  const dotGit = join(path, ".git")
  let gitDirKind: "directory" | "file" | undefined
  try {
    const info = await lstat(dotGit)
    gitDirKind = info.isDirectory() ? "directory" : "file"
  } catch {
    gitDirKind = undefined
  }

  const inside = await runProcess("git", ["-C", path, "rev-parse", "--is-inside-work-tree"])
  if (inside.exitCode !== 0) {
    return { present: true, isGitRepository: false, ...(gitDirKind ? { gitDirKind } : {}) }
  }

  const [branch, revision, status, remote] = await Promise.all([
    runProcess("git", ["-C", path, "branch", "--show-current"]),
    runProcess("git", ["-C", path, "rev-parse", "HEAD"]),
    runProcess("git", ["-C", path, "status", "--porcelain"]),
    runProcess("git", ["-C", path, "remote", "get-url", "origin"]),
  ])

  return {
    present: true,
    isGitRepository: true,
    ...(gitDirKind ? { gitDirKind } : {}),
    ...(branch.stdout.trim() ? { branch: branch.stdout.trim() } : {}),
    ...(revision.stdout.trim() ? { revision: revision.stdout.trim() } : {}),
    dirty: status.stdout.length > 0,
    ...(remote.exitCode === 0 && remote.stdout.trim() ? { remote: remote.stdout.trim() } : {}),
  }
}

export async function inspectRepositorySubpath(
  physicalRoot: string,
  relativePath: string,
): Promise<RepositoryObservation> {
  const path = resolve(physicalRoot, relativePath)
  if (!(await pathExists(path))) return { present: false, isGitRepository: false }

  const physical = await inspectRepository(physicalRoot)
  if (!physical.isGitRepository) return inspectRepository(path)

  const status = await runProcess("git", [
    "-C",
    physicalRoot,
    "status",
    "--porcelain",
    "--",
    relativePath,
  ])
  return {
    ...physical,
    present: true,
    dirty: status.exitCode === 0 && status.stdout.length > 0,
  }
}

export async function cloneRepository(
  remote: string,
  destination: string,
  revision?: { branch?: string; tag?: string; commit?: string },
): Promise<void> {
  const args = ["clone"]
  const namedRevision = revision?.branch ?? revision?.tag
  if (namedRevision) args.push("--branch", namedRevision)
  args.push("--", remote, destination)
  const clone = await runProcess("git", args, { timeoutMs: 5 * 60_000 })
  if (clone.exitCode !== 0) throw new Error(`Git clone failed: ${clone.stderr.trim()}`)
  if (revision?.commit) {
    const checkout = await runProcess("git", [
      "-C",
      destination,
      "checkout",
      "--detach",
      revision.commit,
    ])
    if (checkout.exitCode !== 0) throw new Error(`Git checkout failed: ${checkout.stderr.trim()}`)
  }
}
