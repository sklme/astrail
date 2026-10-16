import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const configSchema = require("../schema/config-v1alpha1.schema.json") as Record<string, unknown>
const localSchema = require("../schema/local-v1alpha1.schema.json") as Record<string, unknown>
const lockSchema = require("../schema/lock-v1alpha1.schema.json") as Record<string, unknown>
const workspaceSchema = require("../schema/workspace-v1alpha1.schema.json") as Record<
  string,
  unknown
>

export type { AstrailSharedConfigV1Alpha1 } from "./generated/config.js"
export type * from "./generated/local.js"
export type * from "./generated/lock.js"
export type * from "./generated/workspace.js"

const effectiveWorkspaceSchema =
  require("../schema/effective-workspace-v1alpha1.schema.json") as Record<string, unknown>

export { configSchema, effectiveWorkspaceSchema, localSchema, lockSchema, workspaceSchema }
