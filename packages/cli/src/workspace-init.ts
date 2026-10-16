import { mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import {
  atomicWrite,
  diagnostic,
  type EditorWorkspaceData,
  inspectAstrailRequirement,
  isRuntimeRequirementDiagnostic,
  journalChange,
  loadWorkspace,
  pathExists,
  resolveWorkspace,
  result,
  runProcess,
  syncEditorWorkspace,
} from "astrail-core"
import { intersects, SemVer, satisfies, valid } from "semver"
import { stringify } from "yaml"
import type { OutputWriter } from "./output.js"
import {
  ASTRAIL_PACKAGE,
  astrailDependency,
  DEFAULT_PNPM_VERSION,
  declaredPackageManager,
  isRecord,
  type PackageManager,
  type PackageManifest,
  readPackage,
  workspacePackagePath,
} from "./workspace-package.js"

export interface InitOptions {
  cwd?: string
  config?: string
  name?: string
  force?: boolean
  skipInstall?: boolean
  dryRun?: boolean
  version: string
}

export interface InitData {
  root: string
  path: string
  created: boolean
  packagePath: string
  packageManager?: string
  installed: boolean
  editorWorkspace?: EditorWorkspaceData
  nextSteps: string[]
}

export async function initializeWorkspace(
  options: InitOptions,
  writer: OutputWriter,
  runner: typeof runProcess = runProcess,
) {
  const path = resolve(options.cwd ?? process.cwd(), options.config ?? "astrail.yaml")
  const root = dirname(path)
  const data: InitData = {
    root,
    path,
    created: false,
    packagePath: workspacePackagePath(root),
    installed: false,
    nextSteps: [],
  }
  if ((await pathExists(path)) && !options.force) {
    return result(data, [diagnostic("ASTR8001", "error", `Manifest already exists: ${path}`)])
  }

  // Validate adoption before writing either file, including when --force is used.
  let manifest: PackageManifest
  let manager: PackageManager
  let requiredRange = minimalWorkspaceRange(options.version)
  try {
    if (await pathExists(path)) {
      const existing = await loadWorkspace({ config: path, astrailVersion: options.version })
      const diagnostics = existing.diagnostics.filter(isRuntimeRequirementDiagnostic)
      if (diagnostics.length) return result(data, diagnostics)
      const shared = existing.layers.find((layer) => layer.kind === "shared")?.value
      if (isRecord(shared?.requires) && typeof shared.requires.astrail === "string") {
        requiredRange = shared.requires.astrail
      }
    }
    const name = normalizeName(options.name ?? basename(root))
    manifest = (await readPackage(data.packagePath)) ?? { name, private: true }
    if (manifest.name === ASTRAIL_PACKAGE) {
      throw new Error(`Cannot add ${ASTRAIL_PACKAGE} as a dependency of itself`)
    }
    const range = astrailDependency(manifest)
    if (range !== undefined && !intersects(range, requiredRange)) {
      throw new Error(
        `${ASTRAIL_PACKAGE}@${range} has no overlap with requires.astrail ${requiredRange}; update the dependency range before initializing.`,
      )
    }
    if (range === undefined) {
      manifest.devDependencies = {
        ...(isRecord(manifest.devDependencies) ? manifest.devDependencies : {}),
        [ASTRAIL_PACKAGE]: `~${options.version}`,
      }
    }
    const declared = declaredPackageManager(manifest)
    const lockedManagers: PackageManager[] = []
    for (const [name, files] of [
      ["pnpm", ["pnpm-lock.yaml"]],
      ["npm", ["package-lock.json", "npm-shrinkwrap.json"]],
      ["yarn", ["yarn.lock"]],
    ] as const) {
      if ((await Promise.all(files.map((file) => pathExists(join(root, file))))).some(Boolean)) {
        lockedManagers.push(name)
      }
    }
    if (
      lockedManagers.length > 1 ||
      (declared && lockedManagers.some((name) => name !== declared.name))
    ) {
      throw new Error(
        "Conflicting package manager declaration and lockfiles; keep one package manager",
      )
    }
    manager = declared?.name ?? lockedManagers[0] ?? "pnpm"
    if (!options.skipInstall && !options.dryRun) {
      // The root may not exist yet; the first version probe needs an existing cwd.
      const probe = await runner(manager, ["--version"], {
        cwd: (await pathExists(root)) ? root : process.cwd(),
      })
      const version = probe.stdout.trim()
      if (probe.exitCode !== 0 || !valid(version)) {
        throw new Error(
          `${manager} is unavailable. Install ${declared ? `${manager}@${declared.version}` : manager}, or retry init with --skip-install.`,
        )
      }
      if (declared && version !== declared.version) {
        throw new Error(
          `${manager}@${version} does not match packageManager ${manifest.packageManager}. Activate the declared version before installing.`,
        )
      }
      manifest.packageManager ??= `${manager}@${version}`
    } else if (!manifest.packageManager && manager === "pnpm") {
      manifest.packageManager = `pnpm@${DEFAULT_PNPM_VERSION}`
    }
  } catch (error) {
    return result(data, [
      diagnostic("ASTR8101", "error", error instanceof Error ? error.message : String(error)),
    ])
  }

  data.packageManager = String(manifest.packageManager ?? manager)
  const name = normalizeName(options.name ?? basename(root))
  const workspace = {
    $schema: "https://sklme.github.io/astrail/schema/workspace/v1alpha1.json",
    apiVersion: "astrail.dev/v1alpha1" as const,
    kind: "Workspace" as const,
    metadata: { name },
    requires: { astrail: requiredRange },
    targets: { codex: { type: "codex" as const, primary: true } },
  }
  const finish = async () => {
    const editor = await syncEditorWorkspace(
      options.dryRun
        ? {
            root,
            config: workspace,
            topology: { repositories: [], environments: [] },
            diagnostics: [],
          }
        : await resolveWorkspace({ config: path, astrailVersion: options.version }),
      { dryRun: options.dryRun === true },
    )
    data.editorWorkspace = editor.data
    return result(data, editor.diagnostics)
  }
  if (options.dryRun) {
    data.nextSteps = [
      "Create astrail.yaml and merge the workspace package.json.",
      ...(options.skipInstall ? [] : [`Install workspace dependencies with ${manager} install.`]),
    ]
    return finish()
  }
  await mkdir(root, { recursive: true })
  await atomicWrite(data.packagePath, `${JSON.stringify(manifest, null, 2)}\n`)
  await atomicWrite(path, stringify(workspace, { lineWidth: 0 }))
  data.created = true
  const installCommand = `${manager} install`
  data.nextSteps = [`Commit package.json and the ${manager} lockfile with ${basename(path)}.`]
  if (options.skipInstall) {
    data.nextSteps.unshift(`Run ${installCommand} in ${root}.`)
    return finish()
  }

  writer.err(`Installing workspace dependencies with ${installCommand}...\n`)
  const installed = await runner(manager, ["install"], { cwd: root, timeoutMs: 300_000 })
  // Package manager logs must not corrupt the CLI's JSON envelope on stdout.
  if (installed.stdout) writer.err(installed.stdout)
  if (installed.stderr) writer.err(installed.stderr)
  if (installed.exitCode !== 0) {
    data.nextSteps.unshift(`Run ${installCommand} in ${root}.`)
    return result(data, [
      diagnostic("ASTR8102", "error", `${installCommand} failed; workspace files were created`, {
        remediation: `Fix the installation error and run ${installCommand} in ${root}; rerunning init is unnecessary.`,
      }),
    ])
  }
  try {
    const local = await readPackage(
      join(root, "node_modules", ...ASTRAIL_PACKAGE.split("/"), "package.json"),
    )
    const dependencyRange = astrailDependency(manifest) as string
    if (
      local?.name !== ASTRAIL_PACKAGE ||
      typeof local.version !== "string" ||
      !valid(local.version)
    ) {
      throw new Error(
        `The installation did not produce a valid workspace-local ${ASTRAIL_PACKAGE} in node_modules.`,
      )
    }
    if (!satisfies(local.version, dependencyRange)) {
      throw new Error(
        `Installed ${ASTRAIL_PACKAGE}@${local.version} does not satisfy the package dependency ${dependencyRange}.`,
      )
    }
    const compatibility = inspectAstrailRequirement(
      { requires: { astrail: requiredRange } },
      path,
      local.version,
    )
    if (!compatibility.success) return result(data, compatibility.diagnostics)
    data.installed = true
    journalChange({
      kind: "file",
      target: "node_modules",
      action: "install",
      after: { installed: true, manager: data.packageManager ?? manager, version: local.version },
    })
  } catch (error) {
    return result(data, [
      diagnostic("ASTR8103", "error", error instanceof Error ? error.message : String(error), {
        remediation: `Install the declared development dependencies in ${root}, using a node_modules installation, then retry astrail commands.`,
      }),
    ])
  }
  return finish()
}

export function minimalWorkspaceRange(version: string): string {
  const parsed = new SemVer(version)
  // The minimal template supports the current minor release series. Patch
  // upgrades do not raise its floor; prereleases must be opted into explicitly.
  const floor = parsed.prerelease.length ? parsed.version : `${parsed.major}.${parsed.minor}.0`
  return `>=${floor} <${parsed.major}.${parsed.minor + 1}.0`
}

function normalizeName(value: string): string {
  return (
    value
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workspace"
  )
}
