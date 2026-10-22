import { createHash } from "node:crypto"
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, readlink, rm } from "node:fs/promises"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { withOperationLock } from "./fs.js"
import { journalChange, journalStep } from "./journal-trace.js"
import type { Result } from "./types.js"

export interface WorkspaceTransaction {
  capture(paths: readonly string[]): Promise<void>
}

/** Restore managed files on failure; business checkouts are deliberately not captured. */
export async function withWorkspaceTransaction<T>(
  root: string,
  operation: (transaction: WorkspaceTransaction) => Promise<Result<T>>,
): Promise<Result<T>> {
  return withOperationLock(root, async () => {
    const snapshots = new Map<string, string | undefined>()
    let backupRoot: string | undefined
    let restored = false
    const rollback = async () => {
      if (restored) return
      await journalStep("workspace.restore", async () => {
        for (const [path, backup] of [...snapshots].reverse()) {
          if ((await fingerprint(path)) === (backup ? await fingerprint(backup) : undefined))
            continue
          await rm(path, { recursive: true, force: true })
          if (backup) {
            await mkdir(dirname(path), { recursive: true })
            await cp(backup, path, { recursive: true, verbatimSymlinks: true })
          }
          journalChange({ kind: "file", target: relative(root, path), action: "restore" })
        }
      })
      restored = true
    }
    let cleanup = true
    try {
      const value = await operation({
        async capture(paths) {
          for (const value of paths) {
            const path = resolve(value)
            const local = relative(root, path)
            if (!local || local === ".." || local.startsWith("../") || isAbsolute(local))
              throw new Error(`Transaction path is outside the workspace: ${path}`)
            if (snapshots.has(path)) continue
            const present = await lstat(path).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error
              return undefined
            })
            if (!present) {
              snapshots.set(path, undefined)
              continue
            }
            backupRoot ??= await mkdtemp(join(root, ".astrail", ".transaction-"))
            const backup = join(backupRoot, String(snapshots.size))
            await cp(path, backup, { recursive: true, verbatimSymlinks: true })
            snapshots.set(path, backup)
          }
        },
      })
      if (!value.success) await rollback()
      return value
    } catch (error) {
      try {
        await rollback()
      } catch (restoreError) {
        cleanup = false
        throw new Error(`Workspace restoration failed; backups retained at ${backupRoot}`, {
          cause: restoreError,
        })
      }
      throw error
    } finally {
      if (cleanup && backupRoot) await rm(backupRoot, { recursive: true, force: true })
    }
  })
}

async function fingerprint(path: string): Promise<string | undefined> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
    return undefined
  })
  if (!info) return undefined
  const hash = createHash("sha256").update(String(info.mode))
  if (info.isSymbolicLink()) hash.update(await readlink(path))
  else if (info.isDirectory()) {
    for (const name of (await readdir(path)).sort())
      hash.update(JSON.stringify([name, await fingerprint(join(path, name))]))
  } else hash.update(await readFile(path))
  return hash.digest("hex")
}
