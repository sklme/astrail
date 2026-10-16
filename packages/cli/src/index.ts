#!/usr/bin/env node

import { fileURLToPath } from "node:url"
import { diagnostic, result } from "astrail-core"
import { CommanderError } from "commander"
import {
  type LaunchOptions,
  LaunchUsageError,
  readLaunchOptions,
  runLocalRuntime,
  selectLocalRuntime,
} from "./local-runtime.js"
import { CLI_EXIT_CODES, emitResult, processWriter } from "./output.js"
import { RuntimeCompatibilityError } from "./runtime-check.js"

const startedAt = Date.now()
const args = process.argv.slice(2)
let options: LaunchOptions = { json: args.includes("--json"), command: "" }
try {
  options = readLaunchOptions(args)
  const localEntry = await selectLocalRuntime(options, fileURLToPath(import.meta.url))
  if (localEntry) {
    process.exitCode = await runLocalRuntime(localEntry, args)
  } else {
    const { createProgram } = await import("./program.js")
    const program = createProgram()
    program.exitOverride()
    await program.parseAsync(process.argv)
  }
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode === 0 ? CLI_EXIT_CODES.success : CLI_EXIT_CODES.usage
  } else if (error instanceof RuntimeCompatibilityError) {
    emitResult({
      command: options.command || "astrail",
      result: error.inspection,
      json: options.json,
      writer: processWriter,
      startedAt,
      workspaceRoot: error.inspection.data.root,
      human: () => "",
    })
  } else {
    emitResult({
      command: options.command || "astrail",
      result: result(null, [
        diagnostic("ASTR8100", "error", error instanceof Error ? error.message : String(error)),
      ]),
      json: options.json,
      writer: processWriter,
      startedAt,
      human: () => "",
    })
    process.exitCode =
      error instanceof LaunchUsageError ? CLI_EXIT_CODES.usage : CLI_EXIT_CODES.runtime
  }
}
