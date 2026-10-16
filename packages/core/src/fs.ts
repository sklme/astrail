import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { journalFileWrite } from "./journal-trace.js"

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined
    throw error
  }
}

export async function atomicWrite(path: string, content: string): Promise<void> {
  const recorded = await journalFileWrite(path, content)
  await mkdir(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${randomUUID()}.astrail.tmp`)
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" })
    await rename(temporary, path)
    recorded()
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}

export interface OperationLock {
  path: string
  release(): Promise<void>
}

export async function acquireOperationLock(root: string): Promise<OperationLock> {
  const lockPath = join(root, ".astrail", "operation.lock")
  await mkdir(dirname(lockPath), { recursive: true })
  try {
    const handle = await open(lockPath, "wx")
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`)
    await handle.close()
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      const age = await lockAge(lockPath)
      if (age > 30 * 60 * 1000) {
        await rm(lockPath, { force: true })
        return acquireOperationLock(root)
      }
      throw new Error(`Another Astrail operation is active (${lockPath})`)
    }
    throw error
  }
  return {
    path: lockPath,
    async release() {
      await rm(lockPath, { force: true })
    },
  }
}

async function lockAge(path: string): Promise<number> {
  try {
    const info = await stat(path)
    return Date.now() - info.mtimeMs
  } catch {
    return 0
  }
}

export function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value
}
