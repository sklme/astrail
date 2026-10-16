import { lstat, mkdir, mkdtemp, realpath, rename, rm, rmdir } from "node:fs/promises"
import { dirname, join, relative, sep } from "node:path"
import type { AstrailWorkspaceV1Alpha1 } from "astrail-schema"
import { cloneRepository, inspectRepository } from "./git.js"
import { journalBeforeMutation, journalChange, journalTargets } from "./journal-trace.js"
import { runProcess } from "./process.js"
import { resolveRepositories } from "./resolver.js"
import { type Diagnostic, diagnostic, type ResolvedRepository } from "./types.js"

export interface RepositoryPreparationEntry {
  repository: ResolvedRepository
  action: "clone" | "check"
}

export interface RepositoryPreparationPlan {
  entries: RepositoryPreparationEntry[]
  diagnostics: Diagnostic[]
}

// Only follow source ancestors; environment membership and capabilities are unrelated.
export async function planRepositoryPreparation(
  config: AstrailWorkspaceV1Alpha1,
  root: string,
  id: string,
): Promise<RepositoryPreparationPlan> {
  const diagnostics: Diagnostic[] = []
  const repositories = await resolveRepositories(config, root, false, diagnostics)
  const entries: RepositoryPreparationEntry[] = []
  const visited = new Set<string>()
  const visit = async (repositoryId: string): Promise<void> => {
    if (visited.has(repositoryId)) return
    visited.add(repositoryId)
    const repository = repositories.find((item) => item.id === repositoryId)
    if (!repository?.path) {
      diagnostics.push(preparationError(`Repository ${repositoryId} has no usable path`))
      return
    }
    if (repository.source.type === "subpath") await visit(repository.source.repository)
    repository.observation = await inspectRepository(repository.path)
    const info = await entryInfo(repository.path)
    if (repository.source.type === "git") {
      const parent = await entryInfo(dirname(repository.path))
      if (parent && (!parent.isDirectory() || parent.isSymbolicLink())) {
        diagnostics.push(
          preparationError(
            `Managed repository parent is not a directory: ${dirname(repository.path)}`,
          ),
        )
      }
      if (info) diagnostics.push(...(await validateCheckout(repository)))
    } else if (info) {
      diagnostics.push(...(await validateDirectory(repository, entries)))
    } else {
      const pendingParent = entries.some((entry) => entry.action === "clone")
      if (repository.source.type !== "subpath" || !pendingParent) {
        diagnostics.push(
          preparationError(`Repository ${repositoryId} path is missing: ${repository.path}`),
        )
      }
    }
    entries.push({
      repository,
      action: repository.source.type === "git" && !info ? "clone" : "check",
    })
  }
  await visit(id)
  return { entries, diagnostics }
}

// Caller owns the workspace operation lock. Never remove or modify an existing checkout.
export async function applyRepositoryPreparation(plan: RepositoryPreparationPlan): Promise<void> {
  for (const entry of plan.entries) {
    const repository = entry.repository
    const path = repository.path
    if (!path) throw new Error(`Repository ${repository.id} has no path`)
    if (entry.action === "clone" && repository.source.type === "git") {
      if (await entryInfo(path)) throw new Error(`Clone destination is occupied: ${path}`)
      const parent = dirname(path)
      const parentInfo = await entryInfo(parent)
      if (parentInfo && (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())) {
        throw new Error(`Managed repository parent is not a directory: ${parent}`)
      }
      await mkdir(parent, { recursive: true })
      journalTargets({ repositories: [repository.id] })
      await journalBeforeMutation()
      const temporary = await mkdtemp(join(parent, ".astrail-clone-"))
      try {
        const checkout = join(temporary, "checkout")
        await cloneRepository(repository.source.url, checkout, repository.source.revision)
        const errors = await validateCheckout({
          ...repository,
          path: checkout,
          observation: await inspectRepository(checkout),
        })
        if (errors.length) throw new Error(errors.map((item) => item.message).join("; "))
        // Reserve the destination exclusively so rename cannot replace a newly occupied directory.
        await mkdir(path)
        const reserved = await lstat(path)
        try {
          await rename(checkout, path)
          const observation = await inspectRepository(path)
          journalChange({
            kind: "repository",
            target: repository.id,
            action: "clone",
            before: null,
            after: { branch: observation.branch ?? null, revision: observation.revision ?? null },
          })
        } catch (error) {
          const current = await entryInfo(path)
          if (current?.dev === reserved.dev && current.ino === reserved.ino) {
            await rmdir(path).catch(() => undefined)
          }
          throw error
        }
      } finally {
        await rm(temporary, { recursive: true, force: true })
      }
    }
    const current = { ...repository, observation: await inspectRepository(path) }
    const errors =
      repository.source.type === "git"
        ? await validateCheckout(current)
        : await validateDirectory(current, plan.entries)
    if (errors.length) throw new Error(errors.map((item) => item.message).join("; "))
  }
}

async function validateCheckout(repository: ResolvedRepository): Promise<Diagnostic[]> {
  if (repository.source.type !== "git" || !repository.path) return []
  const observation = repository.observation
  const info = await entryInfo(repository.path)
  if (!info?.isDirectory() || !observation?.isGitRepository || !observation.gitDirKind) {
    return [preparationError(`Destination is not a standalone Git checkout: ${repository.path}`)]
  }
  if (
    !observation.remote ||
    normalizeRemote(observation.remote) !== normalizeRemote(repository.source.url)
  ) {
    return [preparationError(`Existing checkout origin conflicts with repository ${repository.id}`)]
  }
  const revision = repository.source.revision
  if (revision?.branch && observation.branch !== revision.branch) {
    return [preparationError(`Existing checkout branch conflicts with repository ${repository.id}`)]
  }
  const ref = revision?.tag ? `refs/tags/${revision.tag}` : revision?.commit
  if (ref) {
    const resolved = await runProcess("git", [
      "-C",
      repository.path,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
    if (resolved.exitCode !== 0 || resolved.stdout.trim() !== observation.revision) {
      return [
        preparationError(`Existing checkout revision conflicts with repository ${repository.id}`),
      ]
    }
  }
  return []
}

async function validateDirectory(
  repository: ResolvedRepository,
  entries: RepositoryPreparationEntry[],
): Promise<Diagnostic[]> {
  if (!repository.path) return [preparationError(`Repository ${repository.id} has no path`)]
  try {
    const actual = await realpath(repository.path)
    if (!(await lstat(actual)).isDirectory()) throw new Error("not a directory")
    if (repository.source.type === "subpath") {
      const parentId = repository.source.repository
      const parent = entries.find((entry) => entry.repository.id === parentId)?.repository.path
      if (!parent) throw new Error("parent unavailable")
      const offset = relative(await realpath(parent), actual)
      if (!offset || offset === ".." || offset.startsWith(`..${sep}`))
        throw new Error("escapes parent")
    }
    return []
  } catch {
    return [
      preparationError(
        `Repository ${repository.id} is not an available directory within its source: ${repository.path}`,
      ),
    ]
  }
}

async function entryInfo(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

function normalizeRemote(value: string): string {
  return value
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
}

function preparationError(message: string): Diagnostic {
  return diagnostic("ASTR7014", "error", message, {
    remediation:
      "Review the source and destination, then preview the same repo add request again. Existing files are never overwritten.",
  })
}
