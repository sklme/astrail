import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import type { ValidateFunction } from "ajv/dist/2020.js"

export interface InputOrigin {
  file: string
  pointer: string
  kind: "with" | "default" | "forward"
  from?: InputOrigin | undefined
}
export interface ConfigInputBinding {
  inputStatus: "resolved" | "pending" | "invalid"
  inputs?: Record<string, unknown>
  inputsDigest?: string
  bindingDigest?: string
  inputOrigins?: Record<string, InputOrigin>
}
const require = createRequire(import.meta.url)
interface Validator {
  compile(schema: object): ValidateFunction
}
const Ajv = require("ajv/dist/2020.js").default as new (options: object) => Validator
const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: true, validateFormats: true })
;(require("ajv-formats").default as (validator: Validator) => void)(ajv)
const forbidden = new Set(["__proto__", "prototype", "constructor"])
const keywords = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "default",
  "description",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "uniqueItems",
  "format",
])
export const pointerPart = (key: string) => key.replaceAll("~", "~0").replaceAll("/", "~1")
export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}
export function inputDigest(value: unknown): string {
  return `sha256-${createHash("sha256").update(canonicalJson(value)).digest("base64")}`
}

function assertData(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertData(item)
    return
  }
  if (object(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key) || key === "$input") throw new Error(`Reserved input key: ${key}`)
      assertData(child)
    }
  } else if (value !== null && !["string", "boolean", "number"].includes(typeof value)) {
    throw new Error("Inputs must contain JSON data")
  } else if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("Input numbers must be finite")
}

function checkSchema(
  schema: unknown,
  pointer = "/inputs",
): asserts schema is Record<string, unknown> {
  if (!object(schema)) throw new Error(`${pointer}: expected an input schema object`)
  for (const key of Object.keys(schema))
    if (!keywords.has(key)) throw new Error(`${pointer}/${key}: unsupported input schema keyword`)
  if (
    !["object", "array", "string", "number", "integer", "boolean", "null"].includes(
      String(schema.type),
    )
  )
    throw new Error(`${pointer}/type: expected a supported single type`)
  if (schema.type === "object" && schema.additionalProperties !== false)
    throw new Error(`${pointer}: object inputs require additionalProperties: false`)
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false)
    throw new Error(`${pointer}/additionalProperties: only false is supported`)
  if (schema.format !== undefined && schema.format !== "uri")
    throw new Error(`${pointer}/format: only uri is supported`)
  if (schema.properties !== undefined) {
    if (!object(schema.properties)) throw new Error(`${pointer}/properties: expected an object`)
    for (const [key, child] of Object.entries(schema.properties)) {
      if (forbidden.has(key) || key === "$input")
        throw new Error(`${pointer}/properties: reserved key ${key}`)
      checkSchema(child, `${pointer}/properties/${pointerPart(key)}`)
    }
  }
  if (schema.items !== undefined) checkSchema(schema.items, `${pointer}/items`)
  if (schema.type === "array" && schema.items === undefined)
    throw new Error(`${pointer}/items: required for array inputs`)
  // Validate defaults even on optional objects that are never instantiated.
  const validate = ajv.compile(schema)
  if (Object.hasOwn(schema, "default")) {
    assertData(schema.default)
    const value = fillDefaults(schema, structuredClone(schema.default), "", () => {})
    if (!validate(value))
      throw new Error(`${pointer}/default: invalid default: ${JSON.stringify(validate.errors)}`)
  }
  if (schema.enum !== undefined) assertData(schema.enum)
}

function fillDefaults(
  schema: Record<string, unknown>,
  value: unknown,
  pointer: string,
  record: (pointer: string, schemaPointer: string) => void,
  schemaPointer = "/inputs",
): unknown {
  if (value === undefined && Object.hasOwn(schema, "default")) {
    value = structuredClone(schema.default)
    const mark = (item: unknown, p: string, sp: string) => {
      record(p, sp)
      if (object(item) || Array.isArray(item))
        for (const [key, child] of Object.entries(item))
          mark(child, `${p}/${pointerPart(key)}`, `${sp}/${pointerPart(key)}`)
    }
    mark(value, pointer, `${schemaPointer}/default`)
  }
  if (object(value) && object(schema.default)) {
    const merge = (
      target: Record<string, unknown>,
      defaults: Record<string, unknown>,
      p: string,
      sp: string,
    ) => {
      for (const [key, child] of Object.entries(defaults)) {
        const next = `${p}/${pointerPart(key)}`
        const source = `${sp}/${pointerPart(key)}`
        if (!Object.hasOwn(target, key)) {
          target[key] = structuredClone(child)
          const mark = (item: unknown, pointer: string, schemaPointer: string) => {
            record(pointer, schemaPointer)
            if (object(item) || Array.isArray(item))
              for (const [name, nested] of Object.entries(item))
                mark(
                  nested,
                  `${pointer}/${pointerPart(name)}`,
                  `${schemaPointer}/${pointerPart(name)}`,
                )
          }
          mark(child, next, source)
        } else if (object(target[key]) && object(child))
          merge(target[key] as Record<string, unknown>, child, next, source)
      }
    }
    merge(value, schema.default, pointer, `${schemaPointer}/default`)
  }
  if (object(value) && object(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      const next = fillDefaults(
        child as Record<string, unknown>,
        Object.hasOwn(value, key) ? value[key] : undefined,
        `${pointer}/${pointerPart(key)}`,
        record,
        `${schemaPointer}/properties/${pointerPart(key)}`,
      )
      if (next !== undefined) value[key] = next
    }
  } else if (Array.isArray(value) && object(schema.items)) {
    value = value.map((item, index) =>
      fillDefaults(
        schema.items as Record<string, unknown>,
        item,
        `${pointer}/${index}`,
        record,
        `${schemaPointer}/items`,
      ),
    )
  }
  return value
}

export function bindConfigInputs(options: {
  schema?: unknown
  supplied: Record<string, unknown>
  file: string
  reference: InputOrigin
  parent?: ConfigInputBinding | undefined
  key: string
  integrity?: string | undefined
  commit?: string | undefined
}): ConfigInputBinding {
  const origins: Record<string, InputOrigin> = {}
  const expand = (value: unknown, pointer: string, origin: InputOrigin): unknown => {
    if (object(value) && Object.hasOwn(value, "$input")) {
      const name = value.$input
      if (
        Object.keys(value).length !== 1 ||
        typeof name !== "string" ||
        !options.parent?.inputs ||
        !Object.hasOwn(options.parent.inputs, name)
      )
        throw new Error(`${origin.file}${origin.pointer}: invalid or missing parent $input`)
      const forwarded = structuredClone(options.parent.inputs[name])
      const p = `/${pointerPart(name)}`
      const mark = (item: unknown, destination: string, source: string) => {
        origins[destination] = {
          ...origin,
          kind: "forward",
          ...(options.parent?.inputOrigins?.[source]
            ? { from: options.parent.inputOrigins[source] }
            : {}),
        }
        if (object(item) || Array.isArray(item))
          for (const [key, child] of Object.entries(item))
            mark(child, `${destination}/${pointerPart(key)}`, `${source}/${pointerPart(key)}`)
      }
      mark(forwarded, pointer, p)
      return forwarded
    }
    origins[pointer] = origin
    if (Array.isArray(value))
      return value.map((child, index) =>
        expand(child, `${pointer}/${index}`, { ...origin, pointer: `${origin.pointer}/${index}` }),
      )
    if (object(value))
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [
          key,
          expand(child, `${pointer}/${pointerPart(key)}`, {
            ...origin,
            pointer: `${origin.pointer}/${pointerPart(key)}`,
          }),
        ]),
      )
    return value
  }
  const supplied = expand(options.supplied, "", options.reference)
  assertData(supplied)
  const schema = options.schema ?? { type: "object", properties: {}, additionalProperties: false }
  checkSchema(schema)
  if (schema.type !== "object") throw new Error("/inputs/type: root inputs must be an object")
  const inputs = fillDefaults(schema, supplied, "", (pointer, schemaPointer) => {
    origins[pointer] = { file: options.file, pointer: schemaPointer, kind: "default" }
  }) as Record<string, unknown>
  const validate = ajv.compile(schema)
  if (!validate(inputs))
    throw new Error(
      `${options.reference.file}${options.reference.pointer}: invalid inputs: ${JSON.stringify(validate.errors)}`,
    )
  const inputsDigest = inputDigest(inputs)
  return {
    inputStatus: "resolved",
    inputs,
    inputsDigest,
    inputOrigins: origins,
    bindingDigest: inputDigest([
      options.key,
      options.integrity ?? null,
      options.commit ?? null,
      inputDigest(schema),
      inputsDigest,
    ]),
  }
}

export function configBindingSnapshot(
  configs: Array<{
    key: string
    declaresInputs?: boolean
    bindingDigest?: string
    inputStatus?: string
  }>,
): string {
  return inputDigest(
    configs
      .filter((item) => item.declaresInputs || item.inputStatus === "invalid")
      .map((item) => [item.key, item.bindingDigest ?? null, item.inputStatus])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  )
}
