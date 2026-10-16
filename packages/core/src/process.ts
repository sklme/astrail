import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runProcess(
  executable: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  try {
    const { stdout, stderr } = await execFileAsync(executable, [...args], {
      cwd: options.cwd,
      encoding: "utf8",
      timeout: options.timeoutMs ?? 30_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (error) {
    const processError = error as Error & {
      stdout?: string
      stderr?: string
      code?: number | string
    }
    return {
      stdout: processError.stdout ?? "",
      stderr: processError.stderr ?? processError.message,
      exitCode: typeof processError.code === "number" ? processError.code : 1,
    }
  }
}
