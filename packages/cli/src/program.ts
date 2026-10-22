import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  applyEnvironmentAddition,
  applyEnvironmentCheckout,
  applyFilePlan,
  applyRepositoryAddition,
  applySkillAddition,
  applySkillImport,
  type ChangePlan,
  type Diagnostic,
  diagnostic,
  discoverRepositorySkills,
  discoverWorkspaceRoot,
  doctorWorkspace,
  type EditorWorkspaceData,
  type EnvironmentAdditionApplyData,
  type EnvironmentAdditionPlan,
  type EnvironmentCheckoutApplyData,
  type EnvironmentCheckoutPlan,
  explainProvenance,
  getEnvironmentCheckoutStatus,
  journalSkipStep,
  listJournal,
  loadContextContent,
  loadWorkspace,
  planEnvironmentAddition,
  planEnvironmentCheckout,
  planLock,
  planRepositoryAddition,
  planSkillAddition,
  planSkillImport,
  type RepositoryAdditionApplyData,
  type RepositoryAdditionPlan,
  type RepositorySkillInventory,
  type ResolvedContextSource,
  type ResolvedWorkspace,
  type Result,
  type RuntimeMode,
  resolveCapabilities,
  resolveRepositories,
  resolveWorkspace,
  restorePreviousLock,
  result,
  type runProcess,
  type SkillAdditionApplyData,
  type SkillAdditionPlan,
  type SkillDiscoveryResult,
  type SkillImportApplyData,
  type SkillImportPlan,
  showJournal,
  summarizeRepositorySkillDiscovery,
  syncEditorWorkspace,
  validateWorkspace,
  workspaceStatus,
} from "astrail-core"
import { Command } from "commander"
import { stringify } from "yaml"
import {
  EDITOR_CAPABILITY,
  type EditorDependencies,
  openEditor,
  renderEditorOpen,
  renderEditorWorkspace,
} from "./editor.js"
import {
  createTerminalEnvironmentPrompter,
  type EnvironmentPrompter,
} from "./environment-prompt.js"
import {
  installWorkspace,
  SETUP_HANDOFF_INSTRUCTION,
  type WorkspaceInstallData,
} from "./install.js"
import { executeWithJournal, renderJournal, renderJournalOperation } from "./journal.js"
import { isWorkspaceRuntime } from "./local-runtime.js"
import { CLI_EXIT_CODES, emitResult, type OutputWriter, processWriter, table } from "./output.js"
import {
  doctorWorkspaceProjections,
  type ProjectionHealth,
  planWorkspaceProjections,
  syncWorkspaceProjections,
  workspaceGitResolutions,
} from "./projections.js"
import { createTerminalRepositoryPrompter, type RepositoryPrompter } from "./repository-prompt.js"
import { RuntimeCompatibilityError, requireWorkspaceRuntime } from "./runtime-check.js"
import {
  createTerminalSkillImportPrompter,
  createTerminalSkillPrompter,
  type SkillImportPrompter,
  type SkillPrompter,
} from "./skill-prompt.js"
import { initializeWorkspace } from "./workspace-init.js"

interface GlobalOptions {
  json?: boolean
  cwd?: string
  config?: string
}

interface CommandContext {
  cwd?: string
  config?: string
  json: boolean
}

interface ContextLoadData {
  context: ResolvedContextSource | null
  content?: string
  files?: string[]
}

type CliWorkspaceStatus = Awaited<ReturnType<typeof workspaceStatus>>["data"] & {
  codex: Awaited<ReturnType<typeof doctorWorkspaceProjections>>["data"]["codex"]
  projections: ProjectionHealth
}

interface CliDoctorData {
  root: string
  workspace: Awaited<ReturnType<typeof workspaceStatus>>["data"]
  tools: Awaited<ReturnType<typeof doctorWorkspace>>["data"]["tools"]
  codex: Awaited<ReturnType<typeof doctorWorkspaceProjections>>["data"]["codex"]
  projections: ProjectionHealth
  repositorySkills: RepositorySkillInventory
}

interface AgentNextStep {
  operation:
    | "open"
    | "install"
    | "repository-add"
    | "skill-discover"
    | "skill-import"
    | "environment-add"
  command: string
  reason: string
  requiresAuthorization: boolean
}

type CliRepositoryAdditionData = RepositoryAdditionApplyData & {
  editorWorkspace?: EditorWorkspaceData
  repositorySkills?: RepositorySkillInventory
  skillImport?: SkillImportApplyData
  nextSteps?: AgentNextStep[]
}

type CliBootstrapData = WorkspaceInstallData

export interface ProgramDependencies {
  editor?: EditorDependencies
  environmentPrompter?: EnvironmentPrompter
  repositoryPrompter?: RepositoryPrompter
  skillPrompter?: SkillPrompter
  skillImportPrompter?: SkillImportPrompter
  packageManagerRunner?: typeof runProcess
}

export const CLI_VERSION = readCliVersion()

export function createProgram(
  writer: OutputWriter = processWriter,
  dependencies: ProgramDependencies = {},
): Command {
  const program = new Command("astrail")
    .description("Chart the working trail for every agent")
    .version(CLI_VERSION)
    .option("--json", "emit a stable structured JSON envelope")
    .option("--cwd <path>", "start workspace discovery from this directory")
    .option("--config <path>", "use an explicit Astrail manifest")
    .showHelpAfterError()
    .configureOutput({
      writeOut: (value) => writer.out(value),
      writeErr: (value) => writer.err(value),
    })

  program
    .command("init")
    .description("create or adopt a minimal Astrail workspace")
    .option("--name <name>", "workspace identifier")
    .option("--target <target>", "initial agent target: codex or codebuddy (default: codex)")
    .option("--force", "replace an existing minimal manifest")
    .option("--runtime <mode>", "select and persist global or local CLI mode")
    .option("--skip-install", "write workspace files without installing dependencies")
    .option("--dry-run", "preview initialization without writing or installing")
    .action(
      async (
        options: {
          name?: string
          target?: "codex" | "codebuddy"
          force?: boolean
          skipInstall?: boolean
          dryRun?: boolean
          runtime?: RuntimeMode
        },
        command: Command,
      ) => {
        await execute("init", command, writer, async (context) => {
          const initialized = await initializeWorkspace(
            { ...context, ...options, version: CLI_VERSION },
            writer,
            dependencies.packageManagerRunner,
          )
          return result(
            {
              ...initialized.data,
              nextSteps: initialized.success
                ? [
                    ...initialized.data.nextSteps,
                    {
                      operation: "install",
                      command: "astrail --json install --dry-run",
                      reason: "Preview workspace installation, automatic locking and projection.",
                      requiresAuthorization: false,
                    },
                    editorOpenStep(),
                  ]
                : initialized.data.nextSteps,
            },
            initialized.diagnostics,
          )
        })
      },
    )

  program
    .command("validate")
    .description("validate declarations, composition, references, trust, and secrets")
    .action(async (_options: unknown, command: Command) => {
      await execute("validate", command, writer, (context) => validateWorkspace(context))
    })

  program
    .command("status")
    .description("show the resolved workspace and current observations")
    .action(async (_options: unknown, command: Command) => {
      await execute<CliWorkspaceStatus>(
        "status",
        command,
        writer,
        async (context) => {
          const base = await workspaceStatus(context)
          await describeRuntime(base.data)
          const codex = await doctorWorkspaceProjections(base.data)
          const diagnostics = uniqueDiagnostics([...base.diagnostics, ...codex.diagnostics])
          return result({ ...base.data, ...codex.data }, diagnostics)
        },
        renderWorkspaceStatus,
      )
    })

  program
    .command("doctor")
    .description("diagnose workspace, tools, and target projection health")
    .option("--strict", "escalate warnings to errors")
    .action(async (options: { strict?: boolean }, command: Command) => {
      await execute<CliDoctorData>(
        "doctor",
        command,
        writer,
        async (context) => {
          const base = await doctorWorkspace(context)
          await describeRuntime(base.data.workspace)
          const codex = await doctorWorkspaceProjections(base.data.workspace)
          const combined = uniqueDiagnostics([...base.diagnostics, ...codex.diagnostics])
          const diagnostics = options.strict ? escalateWarnings(combined) : combined
          return result(
            {
              root: base.data.workspace.root,
              workspace: { ...base.data.workspace, diagnostics },
              tools: base.data.tools,
              ...codex.data,
              repositorySkills: base.data.repositorySkills,
            },
            diagnostics,
          )
        },
        renderDoctor,
      )
    })

  addEditorCommands(program, writer, dependencies)
  addConfigCommands(program, writer)
  addRepositoryCommands(program, writer, dependencies)
  addEnvironmentCommands(program, writer, dependencies)
  addContextCommands(program, writer)
  addSkillCommands(program, writer, dependencies)
  addCapabilityCommands(program, writer)
  addProjectionCommands(program, writer)
  addLifecycleCommands(program, writer)
  addJournalCommands(program, writer)
  return program
}

function editorOpenStep(): AgentNextStep {
  return {
    operation: "open",
    command: "astrail --json open --editor <vscode|cursor|codebuddy> --dry-run",
    reason: "Ask your agent to open all repositories in an editor, using the astrail-editor Skill.",
    requiresAuthorization: false,
  }
}

function addEditorCommands(
  program: Command,
  writer: OutputWriter,
  dependencies: ProgramDependencies,
): void {
  const editor = program
    .command("editor")
    .description("discover editors and synchronize the multi-repository workspace")
  editor
    .command("list")
    .description("list supported editors and agent-friendly commands")
    .action(async (_options: unknown, command: Command) => {
      await execute(
        "editor list",
        command,
        writer,
        async () => result(EDITOR_CAPABILITY),
        (data) =>
          `${data.description}\nEditors: ${data.editors.join(", ")}\n${data.preview}\n${data.execute}\n${data.sync}`,
      )
    })
  editor
    .command("sync")
    .description("synchronize the workspace file without opening an editor")
    .option("--dry-run", "preview without writing")
    .action(async (options: { dryRun?: boolean }, command: Command) => {
      await execute(
        "editor sync",
        command,
        writer,
        async (context) =>
          syncEditorWorkspace(await resolveWorkspace(context), { dryRun: options.dryRun === true }),
        renderEditorWorkspace,
      )
    })
  program
    .command("open")
    .description("synchronize and open all repositories in an editor (agent-friendly, no prompts)")
    .option(
      "--editor <editor>",
      "vscode, cursor, or codebuddy; defaults to editor.default or vscode",
    )
    .option("--dry-run", "preview workspace and launch actions without writing or launching")
    .action(async (options: { editor?: string; dryRun?: boolean }, command: Command) => {
      await execute(
        "open",
        command,
        writer,
        async (context) =>
          openEditor(await resolveWorkspace(context), options, dependencies.editor),
        renderEditorOpen,
      )
    })
}

function readCliVersion(): string {
  const metadata = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown }
  if (typeof metadata.version !== "string" || metadata.version.length === 0) {
    throw new Error("astrail package metadata does not declare a version")
  }
  return metadata.version
}

function addSkillCommands(
  program: Command,
  writer: OutputWriter,
  dependencies: ProgramDependencies,
): void {
  const skill = program.command("skill").description("author Skill Capability declarations")
  skill
    .command("add")
    .description("interactively add a Skill or consume a machine-readable request")
    .option("--input <path>", "JSON request file, or - for stdin")
    .option("--dry-run", "preview without writing")
    .option("--yes", "authorize the reviewed Skill plan")
    .option("--plan-id <id>", "identifier returned by the reviewed dry-run")
    .action(
      async (
        options: { input?: string; dryRun?: boolean; yes?: boolean; planId?: string },
        command: Command,
      ) => {
        await execute<SkillAdditionApplyData | { applied: false; plan: null }>(
          "skill add",
          command,
          writer,
          async (context) => {
            const machineInput = options.input !== undefined
            if (
              !machineInput &&
              (context.json || (!dependencies.skillPrompter && !process.stdin.isTTY))
            ) {
              return result({ applied: false, plan: null }, [
                diagnostic("ASTR8020", "error", "Interactive Skill input requires a terminal", {
                  remediation: "Provide --input <file|->. JSON mode is always non-interactive.",
                }),
              ])
            }

            const prompter = dependencies.skillPrompter ?? createTerminalSkillPrompter()
            const input = machineInput
              ? await readSkillInput(options.input as string, context.cwd)
              : await prompter.collect()
            const plan = await planSkillAddition(input, context)
            if (options.dryRun || plan.diagnostics.some((item) => item.severity === "error")) {
              return result({ applied: false, plan }, plan.diagnostics)
            }

            if (machineInput) {
              if (!options.planId) {
                return result({ applied: false, plan }, [
                  ...plan.diagnostics,
                  diagnostic(
                    "ASTR8021",
                    "error",
                    "Machine Skill apply requires the reviewed plan ID",
                    {
                      remediation:
                        "Run with --dry-run --json, review data.plan.planId, then pass --yes --plan-id <id>.",
                    },
                  ),
                ])
              }
              return applySkillAddition(plan, {
                authorized: options.yes === true,
                expectedPlanId: options.planId,
              })
            }

            writer.out(`${renderSkillPlan(plan)}\n`)
            if (!(await prompter.confirm(plan))) {
              return result({ applied: false, plan }, [
                ...plan.diagnostics,
                diagnostic("ASTR8022", "information", "Skill addition cancelled"),
              ])
            }
            return applySkillAddition(plan, { authorized: true })
          },
          (data) => (data.plan ? renderSkillApply(data) : ""),
        )
      },
    )

  skill
    .command("discover")
    .description("discover Skills already owned by declared repositories")
    .option("--all", "scan all declared repositories")
    .option(
      "--repository <id>",
      "scan one declared repository; repeat to select more",
      collectOption,
      [],
    )
    .action(async (options: { all?: boolean; repository: string[] }, command: Command) => {
      await execute<SkillDiscoveryResult>(
        "skill discover",
        command,
        writer,
        async (context) => {
          const discovered = await discoverRepositorySkills(
            { all: options.all === true, repositories: options.repository },
            context,
          )
          return result(discovered, discovered.diagnostics)
        },
        renderSkillDiscovery,
      )
    })

  skill
    .command("import")
    .description("selectively import discovered repository Skills as Capabilities")
    .option("--input <path>", "JSON selection request file, or - for stdin")
    .option("--all", "discover all repositories for interactive selection")
    .option(
      "--repository <id>",
      "discover one repository for interactive selection; repeat to select more",
      collectOption,
      [],
    )
    .option("--dry-run", "preview without writing")
    .option("--yes", "authorize the reviewed Skill import plan")
    .option("--plan-id <id>", "identifier returned by the reviewed dry-run")
    .action(
      async (
        options: {
          input?: string
          all?: boolean
          repository: string[]
          dryRun?: boolean
          yes?: boolean
          planId?: string
        },
        command: Command,
      ) => {
        await execute<SkillImportApplyData | { applied: false; plan: null; capabilities: [] }>(
          "skill import",
          command,
          writer,
          async (context) => {
            const machineInput = options.input !== undefined
            if (
              !machineInput &&
              (context.json || (!dependencies.skillImportPrompter && !process.stdin.isTTY))
            ) {
              return result({ applied: false, plan: null, capabilities: [] }, [
                diagnostic("ASTR8023", "error", "Interactive Skill import requires a terminal", {
                  remediation: "Provide --input <file|->. JSON mode is always non-interactive.",
                }),
              ])
            }

            const prompter = dependencies.skillImportPrompter ?? createTerminalSkillImportPrompter()
            const input = machineInput
              ? await readSkillInput(options.input as string, context.cwd)
              : await (async () => {
                  const discovered = await discoverRepositorySkills(
                    options.all || options.repository.length > 0
                      ? { all: options.all === true, repositories: options.repository }
                      : { all: true },
                    context,
                  )
                  if (discovered.diagnostics.some((item) => item.severity === "error")) {
                    return { selections: [] }
                  }
                  writer.out(`${renderSkillDiscovery(discovered)}\n`)
                  return prompter.select(discovered.candidates)
                })()
            const plan = await planSkillImport(input, context)
            if (options.dryRun || plan.diagnostics.some((item) => item.severity === "error")) {
              return result({ applied: false, plan, capabilities: [] }, plan.diagnostics)
            }

            if (machineInput) {
              if (!options.planId) {
                return result({ applied: false, plan, capabilities: [] }, [
                  ...plan.diagnostics,
                  diagnostic(
                    "ASTR8024",
                    "error",
                    "Machine Skill import apply requires the reviewed plan ID",
                    {
                      remediation:
                        "Run with --dry-run --json, review data.plan.planId, then pass --yes --plan-id <id>.",
                    },
                  ),
                ])
              }
              return applySkillImport(plan, {
                authorized: options.yes === true,
                expectedPlanId: options.planId,
              })
            }

            writer.out(`${renderSkillImportPlan(plan)}\n`)
            if (!(await prompter.confirm(plan))) {
              return result({ applied: false, plan, capabilities: [] }, [
                ...plan.diagnostics,
                diagnostic("ASTR8025", "information", "Skill import cancelled"),
              ])
            }
            return applySkillImport(plan, { authorized: true })
          },
          (data) => (data.plan ? renderSkillImportApply(data) : ""),
        )
      },
    )
}

async function readSkillInput(path: string, cwd?: string): Promise<unknown> {
  const content =
    path === "-"
      ? await readStandardInput()
      : await readFile(resolve(cwd ?? process.cwd(), path), "utf8")
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Invalid Skill JSON input: ${sanitizeError(error)}`)
  }
}

function renderSkillPlan(plan: SkillAdditionPlan): string {
  if (!plan.addition) return "No Skill plan."
  const capability = plan.addition.capability
  const source = capability.source
  const sourceValue =
    source?.type === "git"
      ? source.url
      : source?.type === "repository"
        ? `${source.repository}/${source.path}`
        : source?.path
  return [
    `Skill plan ${plan.planId}`,
    table([
      {
        id: plan.addition.id,
        identity: capability.identity,
        alias: capability.exposeAs,
        source: source?.type,
        location: sourceValue,
        trusted: capability.trust?.instructions === "trusted",
      },
    ]),
    table(plan.actions),
    "Skill declaration is separate from installation; run astrail install --dry-run afterward.",
  ].join("\n\n")
}

function renderSkillApply(data: SkillAdditionApplyData | { applied: false; plan: null }): string {
  if (!data.plan) return ""
  if (!data.applied) return renderSkillPlan(data.plan)
  return `Added Skill ${data.capability?.id ?? data.plan.addition?.id ?? ""}.\nRun astrail install --dry-run, then astrail install --yes separately to install it.`
}

function renderSkillDiscovery(discovery: SkillDiscoveryResult): string {
  if (discovery.candidates.length === 0) return "No repository Skills discovered."
  return table(
    discovery.candidates.map((candidate, index) => ({
      number: index + 1,
      repository: candidate.repository,
      path: candidate.path,
      name: candidate.name,
      alias: candidate.proposedAlias,
      trusted: candidate.instructionsTrusted,
      state: candidate.alreadyDeclared
        ? `declared:${candidate.existingCapability}`
        : candidate.importable
          ? candidate.conflicts.length > 0
            ? "conflict"
            : "available"
          : "invalid",
    })),
  )
}

function renderSkillImportPlan(plan: SkillImportPlan): string {
  return [
    `Skill import plan ${plan.planId}`,
    table(
      plan.additions.map((addition) => ({
        id: addition.id,
        identity: addition.capability.identity,
        alias: addition.capability.exposeAs,
        repository:
          addition.capability.source?.type === "repository"
            ? addition.capability.source.repository
            : undefined,
        path: addition.capability.source?.path,
        trusted: addition.capability.trust?.instructions === "trusted",
      })),
    ),
    table(plan.actions),
    "Skill import is separate from projection; run astrail install --dry-run afterward.",
  ].join("\n\n")
}

function renderSkillImportApply(
  data: SkillImportApplyData | { applied: false; plan: null; capabilities: [] },
): string {
  if (!data.plan) return ""
  if (!data.applied) return renderSkillImportPlan(data.plan)
  return `Imported ${data.capabilities.length} Skill${data.capabilities.length === 1 ? "" : "s"}.\nRun astrail install --dry-run, then astrail install --yes separately to expose them.`
}

function addConfigCommands(program: Command, writer: OutputWriter): void {
  const config = program
    .command("config")
    .description("inspect effective configuration and provenance")
  config
    .command("show")
    .option("--format <format>", "yaml or json", "yaml")
    .option("--provenance", "include the provenance sidecar")
    .action(async (options: { format: string; provenance?: boolean }, command: Command) => {
      await execute(
        "config show",
        command,
        writer,
        async (context) => {
          const loaded = await loadWorkspace(context)
          return result(
            options.provenance
              ? { effective: loaded.effective, provenance: loaded.provenance }
              : loaded.effective,
            loaded.diagnostics,
          )
        },
        (data) =>
          options.format === "json"
            ? JSON.stringify(data, null, 2)
            : stringify(data, { lineWidth: 0 }),
      )
    })
  config.command("layers").action(async (_options: unknown, command: Command) => {
    await execute(
      "config layers",
      command,
      writer,
      async (context) => {
        const loaded = await loadWorkspace(context)
        return result(
          loaded.layers.map((layer) => ({
            id: layer.id,
            kind: layer.kind,
            order: layer.order,
            source: layer.source,
          })),
          loaded.diagnostics,
        )
      },
      (layers) => table(layers),
    )
  })
  config
    .command("explain")
    .argument("<path>", "dot path or JSON pointer")
    .action(async (path: string, _options: unknown, command: Command) => {
      await execute(
        "config explain",
        command,
        writer,
        async (context) => {
          const loaded = await loadWorkspace(context)
          const entries = explainProvenance(loaded.provenance, path)
          const diagnostics = [...loaded.diagnostics]
          if (!entries.length)
            diagnostics.push(diagnostic("ASTR8002", "warning", `No provenance found for ${path}`))
          return result(entries, diagnostics)
        },
        (entries) =>
          table(
            entries.map((entry) => ({
              layer: entry.layer,
              action: entry.action,
              source: entry.source,
              value: entry.value,
            })),
          ),
      )
    })
}

function addRepositoryCommands(
  program: Command,
  writer: OutputWriter,
  dependencies: ProgramDependencies,
): void {
  const repo = program.command("repo").description("inspect and author workspace repositories")
  repo
    .command("add")
    .description("interactively add a repository or consume a machine-readable request")
    .option("--input <path>", "JSON request file, or - for stdin")
    .option("--dry-run", "preview without writing or cloning")
    .option("--no-prepare", "register only, without preparing the repository")
    .option("--yes", "authorize the reviewed repository plan")
    .option("--plan-id <id>", "identifier returned by the reviewed dry-run")
    .option(
      "--import-skills",
      "offer selective Skill import after preparation (default in interactive mode)",
    )
    .action(
      async (
        options: {
          input?: string
          dryRun?: boolean
          yes?: boolean
          planId?: string
          importSkills?: boolean
          prepare?: boolean
        },
        command: Command,
      ) => {
        await execute<CliRepositoryAdditionData | { applied: false; plan: null }>(
          "repo add",
          command,
          writer,
          async (context) => {
            const machineInput = options.input !== undefined
            if (machineInput && options.importSkills) {
              return result({ applied: false, plan: null }, [
                diagnostic(
                  "ASTR8013",
                  "error",
                  "Machine repository input cannot use interactive --import-skills",
                  {
                    remediation:
                      "Apply the reviewed repository plan, inspect data.repositorySkills, then use astrail --json skill import --input <selection-file> --dry-run.",
                  },
                ),
              ])
            }
            if (
              !machineInput &&
              (context.json || (!dependencies.repositoryPrompter && !process.stdin.isTTY))
            ) {
              return result({ applied: false, plan: null }, [
                diagnostic(
                  "ASTR8010",
                  "error",
                  "Interactive repository input requires a terminal",
                  {
                    remediation: "Provide --input <file|->. JSON mode is always non-interactive.",
                  },
                ),
              ])
            }

            const prompter = dependencies.repositoryPrompter ?? createTerminalRepositoryPrompter()
            const collectedInput = machineInput
              ? await readRepositoryInput(options.input as string, context.cwd)
              : await prompter.collect()
            const input =
              options.prepare === false &&
              typeof collectedInput === "object" &&
              collectedInput !== null &&
              !Array.isArray(collectedInput)
                ? { ...collectedInput, prepare: false }
                : collectedInput
            const plan = await planRepositoryAddition(input, context)
            if (options.dryRun || plan.diagnostics.some((item) => item.severity === "error")) {
              if (!plan.addition || plan.diagnostics.some((item) => item.severity === "error"))
                return result({ applied: false, plan }, plan.diagnostics)
              const workspace = await resolveWorkspace(context)
              const config = {
                ...workspace.config,
                repositories: {
                  ...workspace.config.repositories,
                  [plan.addition.id]: plan.addition.repository,
                },
              }
              const diagnostics = [...workspace.diagnostics]
              const repositories = await resolveRepositories(
                config,
                workspace.root,
                false,
                diagnostics,
              )
              const editorWorkspace = await syncEditorWorkspace(
                {
                  ...workspace,
                  config,
                  topology: { ...workspace.topology, repositories },
                  diagnostics,
                },
                { dryRun: true },
              )
              return result(
                { applied: false, plan, editorWorkspace: editorWorkspace.data },
                uniqueDiagnostics([...plan.diagnostics, ...editorWorkspace.diagnostics]),
              )
            }

            if (machineInput) {
              if (!options.planId) {
                return result({ applied: false, plan }, [
                  ...plan.diagnostics,
                  diagnostic("ASTR8011", "error", "Machine apply requires the reviewed plan ID", {
                    remediation:
                      "Run with --dry-run --json, review data.plan.planId, then pass --yes --plan-id <id>.",
                  }),
                ])
              }
              const applied = await applyRepositoryAddition(plan, {
                authorized: options.yes === true,
                expectedPlanId: options.planId,
              })
              return completeRepositoryAddition(applied, context, {
                importSkills: false,
                writer,
              })
            }

            writer.out(`${renderRepositoryPlan(plan)}\n`)
            if (!(await prompter.confirm(plan))) {
              return result({ applied: false, plan }, [
                ...plan.diagnostics,
                diagnostic("ASTR8012", "information", "Repository addition cancelled"),
              ])
            }
            const applied = await applyRepositoryAddition(plan, { authorized: true })
            return completeRepositoryAddition(applied, context, {
              importSkills: true,
              writer,
              ...(dependencies.skillImportPrompter
                ? { skillImportPrompter: dependencies.skillImportPrompter }
                : {}),
            })
          },
          (data) => (data.plan ? renderRepositoryApply(data) : ""),
        )
      },
    )
  repo.command("list").action(async (_options: unknown, command: Command) => {
    await execute(
      "repo list",
      command,
      writer,
      async (context) => {
        const workspace = await resolveWorkspace({ ...context, observe: true })
        return result(workspace.topology.repositories, workspace.diagnostics)
      },
      renderRepositories,
    )
  })
  for (const name of ["resolve", "show"] as const) {
    repo
      .command(name)
      .argument("<id>")
      .action(async (id: string, _options: unknown, command: Command) => {
        await execute(
          `repo ${name}`,
          command,
          writer,
          async (context) => {
            const workspace = await resolveWorkspace({ ...context, observe: true })
            const repositories = workspace.topology.repositories.filter(
              (repository) => repository.id === id,
            )
            const diagnostics = [...workspace.diagnostics]
            if (repositories.length === 0)
              diagnostics.push(diagnostic("ASTR8003", "error", `Unknown repository ${id}`))
            return result(repositories, diagnostics)
          },
          renderRepositories,
        )
      })
  }
}

async function completeRepositoryAddition(
  applied: Result<RepositoryAdditionApplyData>,
  context: CommandContext,
  options: {
    importSkills: boolean
    writer: OutputWriter
    skillImportPrompter?: SkillImportPrompter
  },
): Promise<Result<CliRepositoryAdditionData>> {
  const repositoryId = applied.data.repository?.id ?? applied.data.plan.addition?.id
  if (!applied.data.applied || !repositoryId) return result(applied.data, applied.diagnostics)
  if (applied.data.preparation?.status === "failed") {
    return result({ ...applied.data, nextSteps: [repositoryRetryStep()] }, applied.diagnostics)
  }

  let discovery = await discoverRepositorySkills({ repositories: [repositoryId] }, context)
  let repositorySkills = summarizeRepositorySkillDiscovery(discovery)
  let skillImport: SkillImportApplyData | undefined
  const editorWorkspace = await syncEditorWorkspace(await resolveWorkspace(context))
  const diagnostics = [...applied.diagnostics, ...editorWorkspace.diagnostics]

  if (options.importSkills && repositorySkills.importable > 0) {
    options.writer.out(
      `Discovered ${repositorySkills.unimported} unimported Skill${repositorySkills.unimported === 1 ? "" : "s"} in repository ${repositoryId}; ${repositorySkills.importable} can be imported now.\n`,
    )
    const prompter = options.skillImportPrompter ?? createTerminalSkillImportPrompter()
    const input = await prompter.select(discovery.candidates, { allowSkip: true })
    if (input.selections.length === 0) {
      diagnostics.push(diagnostic("ASTR8025", "information", "Skill import skipped"))
    } else {
      const plan = await planSkillImport(input, context)
      diagnostics.push(...plan.diagnostics)
      if (plan.diagnostics.some((item) => item.severity === "error")) {
        skillImport = { applied: false, plan, capabilities: [] }
      } else {
        options.writer.out(`${renderSkillImportPlan(plan)}\n`)
        if (await prompter.confirm(plan)) {
          const imported = await applySkillImport(plan, { authorized: true })
          skillImport = imported.data
          diagnostics.push(...imported.diagnostics)
          if (imported.data.applied) {
            discovery = await discoverRepositorySkills({ repositories: [repositoryId] }, context)
            repositorySkills = summarizeRepositorySkillDiscovery(discovery)
          }
        } else {
          skillImport = { applied: false, plan, capabilities: [] }
          diagnostics.push(diagnostic("ASTR8025", "information", "Skill import cancelled"))
        }
      }
    }
  }

  if (repositorySkills.unimported > 0) {
    diagnostics.push(
      diagnostic(
        "ASTR8014",
        "information",
        `Repository ${repositoryId} contains ${repositorySkills.unimported} discoverable Skill${repositorySkills.unimported === 1 ? "" : "s"} that ${repositorySkills.unimported === 1 ? "is" : "are"} not imported`,
        {
          remediation: `Review astrail skill discover --repository ${repositoryId}, then selectively import with astrail skill import --repository ${repositoryId}.`,
          details: { repositorySkills },
        },
      ),
    )
  }

  return result(
    {
      ...applied.data,
      repositorySkills,
      editorWorkspace: editorWorkspace.data,
      ...(skillImport ? { skillImport } : {}),
      nextSteps: repositoryAdditionNextSteps(repositoryId, repositorySkills, skillImport),
    },
    uniqueDiagnostics(diagnostics),
  )
}

function repositoryAdditionNextSteps(
  repositoryId: string,
  repositorySkills: RepositorySkillInventory,
  skillImport?: SkillImportApplyData,
): AgentNextStep[] {
  return [
    editorOpenStep(),
    ...(repositorySkills.unavailableRepositories.length > 0 ? [repositoryRetryStep()] : []),
    ...(repositorySkills.unimported > 0
      ? [
          {
            operation: "skill-discover" as const,
            command: `astrail --json skill discover --repository ${repositoryId}`,
            reason: "Review repository-owned Skill candidates and their trust state.",
            requiresAuthorization: false,
          },
          {
            operation: "skill-import" as const,
            command: "astrail --json skill import --input <selection-file> --dry-run",
            reason: "Preview an explicit selection before declaring repository Skills.",
            requiresAuthorization: false,
          },
        ]
      : []),
    ...(skillImport?.applied
      ? [
          {
            operation: "install" as const,
            command: "astrail --json install --dry-run",
            reason: "Preview projection of the newly imported Skills.",
            requiresAuthorization: false,
          },
        ]
      : []),
    {
      operation: "environment-add",
      command: "astrail --json env add --input <environment-file> --dry-run",
      reason: "Optionally group repositories with explicit environment branch targets.",
      requiresAuthorization: false,
    },
  ]
}

function repositoryRetryStep(): AgentNextStep {
  return {
    operation: "repository-add",
    command: "astrail --json repo add --input <request-file> --dry-run",
    reason:
      "Preview the same repository request to retry preparation; omit prepare: false and --no-prepare if previously used. Identical registration is reused.",
    requiresAuthorization: false,
  }
}

async function readRepositoryInput(path: string, cwd?: string): Promise<unknown> {
  const content =
    path === "-"
      ? await readStandardInput()
      : await readFile(resolve(cwd ?? process.cwd(), path), "utf8")
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Invalid repository JSON input: ${sanitizeError(error)}`)
  }
}

async function readStandardInput(): Promise<string> {
  let content = ""
  for await (const chunk of process.stdin) content += String(chunk)
  return content
}

function renderRepositoryPlan(plan: RepositoryAdditionPlan): string {
  if (!plan.addition) return "No repository plan."
  const source = plan.addition.repository.source
  const sourceValue =
    source.type === "git"
      ? source.url
      : source.type === "local"
        ? source.path
        : `${source.repository}/${source.path}`
  return [
    `Repository plan ${plan.planId}`,
    table([
      {
        id: plan.addition.id,
        role: normalizeRepositoryMetadata(plan.addition.repository.role),
        description:
          normalizeRepositoryMetadata(plan.addition.repository.description) ?? "not declared",
        source: source.type,
        location: sourceValue,
        access: plan.addition.repository.access,
        required: plan.addition.repository.required ?? true,
        target: plan.addition.selectedTarget,
      },
    ]),
    table(plan.actions),
    "After registration/preparation, synchronize the configured editor workspace and its local ownership/ignore entries. No editor is launched.",
    plan.addition.prepare
      ? "This confirmation covers registration and the listed repository preparation actions. Skill import remains optional."
      : "Declaration only: repository preparation is disabled for this request.",
    "Environment configuration is optional; run astrail env add to group repositories with configured branch targets.",
  ].join("\n\n")
}

function renderRepositoryApply(
  data: CliRepositoryAdditionData | { applied: false; plan: null },
): string {
  if (!data.plan) return ""
  if (!data.applied)
    return `${renderRepositoryPlan(data.plan)}${"editorWorkspace" in data && data.editorWorkspace ? `\n${renderEditorWorkspace(data.editorWorkspace)}` : ""}`
  const repositoryId = data.repository?.id ?? data.plan.addition?.id ?? ""
  if (data.preparation?.status === "failed") {
    return `Registered repository ${repositoryId}, but preparation failed. Preview and apply the same repo add request to retry; registration has been preserved.`
  }
  return [
    `${data.plan.registration === "reuse" ? "Reused registered" : "Added"} repository ${repositoryId}.`,
    data.preparation?.status === "ready"
      ? "Repository preparation completed."
      : "Repository preparation skipped (declaration only).",
    data.repositorySkills
      ? data.repositorySkills.unavailableRepositories.length > 0
        ? `Repository Skill discovery is pending until these repositories are available: ${data.repositorySkills.unavailableRepositories.join(", ")}.`
        : `Discovered ${data.repositorySkills.discovered} repository Skill${data.repositorySkills.discovered === 1 ? "" : "s"}: ${data.repositorySkills.imported} imported, ${data.repositorySkills.unimported} unimported, ${data.repositorySkills.importable} importable.`
      : "Repository Skill discovery was not available.",
    data.skillImport?.applied
      ? `Imported ${data.skillImport.capabilities.length} Skill${data.skillImport.capabilities.length === 1 ? "" : "s"}; run astrail install --dry-run before projection.`
      : data.repositorySkills?.unimported
        ? `Run astrail skill import --repository ${repositoryId} to select and trust repository Skills.`
        : "No repository Skill import is pending.",
    data.editorWorkspace ? renderEditorWorkspace(data.editorWorkspace) : "",
    "Environment configuration is optional; run astrail env add to group repositories with configured branch targets.",
  ].join("\n")
}

function addEnvironmentCommands(
  program: Command,
  writer: OutputWriter,
  dependencies: ProgramDependencies,
): void {
  const env = program.command("env").description("inspect, author, and use workspace environments")
  env
    .command("add")
    .description("interactively add an environment or consume a machine-readable request")
    .option("--input <path>", "JSON request file, or - for stdin")
    .option("--dry-run", "preview without writing")
    .option("--yes", "authorize the reviewed environment plan")
    .option("--plan-id <id>", "identifier returned by the reviewed dry-run")
    .action(
      async (
        options: { input?: string; dryRun?: boolean; yes?: boolean; planId?: string },
        command: Command,
      ) => {
        await execute<EnvironmentAdditionApplyData | { applied: false; plan: null }>(
          "env add",
          command,
          writer,
          async (context) => {
            const machineInput = options.input !== undefined
            if (
              !machineInput &&
              (context.json || (!dependencies.environmentPrompter && !process.stdin.isTTY))
            ) {
              return result({ applied: false, plan: null }, [
                diagnostic(
                  "ASTR8030",
                  "error",
                  "Interactive environment input requires a terminal",
                  {
                    remediation: "Provide --input <file|->. JSON mode is always non-interactive.",
                  },
                ),
              ])
            }

            const prompter = dependencies.environmentPrompter ?? createTerminalEnvironmentPrompter()
            const input = machineInput
              ? await readEnvironmentInput(options.input as string, context.cwd)
              : await prompter.collect()
            const plan = await planEnvironmentAddition(input, context)
            if (options.dryRun || plan.diagnostics.some((item) => item.severity === "error")) {
              return result({ applied: false, plan }, plan.diagnostics)
            }

            if (machineInput) {
              if (!options.planId) {
                return result({ applied: false, plan }, [
                  ...plan.diagnostics,
                  diagnostic(
                    "ASTR8031",
                    "error",
                    "Machine environment apply requires the reviewed plan ID",
                    {
                      remediation:
                        "Run with --dry-run --json, review data.plan.planId, then pass --yes --plan-id <id>.",
                    },
                  ),
                ])
              }
              return applyEnvironmentAddition(plan, {
                authorized: options.yes === true,
                expectedPlanId: options.planId,
              })
            }

            writer.out(`${renderEnvironmentAdditionPlan(plan)}\n`)
            if (!(await prompter.confirm(plan))) {
              return result({ applied: false, plan }, [
                ...plan.diagnostics,
                diagnostic("ASTR8032", "information", "Environment addition cancelled"),
              ])
            }
            return applyEnvironmentAddition(plan, { authorized: true })
          },
          (data) => (data.plan ? renderEnvironmentAdditionApply(data) : ""),
        )
      },
    )
  env.command("list").action(async (_options: unknown, command: Command) => {
    await execute(
      "env list",
      command,
      writer,
      async (context) => {
        const workspace = await resolveWorkspace(context)
        return result(workspace.topology.environments, workspace.diagnostics)
      },
      (environments) => table(environments),
    )
  })
  for (const name of ["resolve", "show"] as const) {
    env
      .command(name)
      .argument("<id>")
      .action(async (id: string, _options: unknown, command: Command) => {
        await execute(`env ${name}`, command, writer, async (context) => {
          const workspace = await resolveWorkspace(context)
          const environment = workspace.topology.environments.find((item) => item.id === id)
          return result(
            environment ?? null,
            environment
              ? workspace.diagnostics
              : [
                  ...workspace.diagnostics,
                  diagnostic("ASTR8004", "error", `Unknown environment ${id}`),
                ],
          )
        })
      })
  }
  env
    .command("status")
    .argument("<id>")
    .action(async (id: string, _options: unknown, command: Command) => {
      await execute(
        "env status",
        command,
        writer,
        (context) => getEnvironmentCheckoutStatus(id, context),
        (status) => (status ? renderEnvironmentStatus(status) : ""),
      )
    })
  env
    .command("checkout")
    .argument("<id>")
    .option("--dry-run", "preview without switching branches")
    .option("--yes", "authorize the reviewed checkout plan")
    .option("--plan-id <id>", "identifier returned by the reviewed dry-run")
    .action(
      async (
        id: string,
        options: { dryRun?: boolean; yes?: boolean; planId?: string },
        command: Command,
      ) => {
        await execute<EnvironmentCheckoutApplyData>(
          "env checkout",
          command,
          writer,
          async (context) => {
            const plan = await planEnvironmentCheckout(id, context)
            const preview: EnvironmentCheckoutApplyData = {
              applied: false,
              plan,
              completedActions: [],
              remainingActions: plan.actions
                .filter((action) => action.type === "switch")
                .map((action) => action.id),
            }
            if (options.dryRun || plan.diagnostics.some((item) => item.severity === "error")) {
              return result(preview, plan.diagnostics)
            }
            if (options.yes && !options.planId) {
              return result(preview, [
                ...plan.diagnostics,
                diagnostic("ASTR8033", "error", "Checkout requires the reviewed plan ID", {
                  remediation:
                    "Run env checkout --dry-run --json, review data.plan.planId, then pass --yes --plan-id <id>.",
                }),
              ])
            }
            return applyEnvironmentCheckout(plan, {
              authorized: options.yes === true,
              ...(options.planId ? { expectedPlanId: options.planId } : {}),
            })
          },
          renderEnvironmentCheckoutApply,
        )
      },
    )
}

async function readEnvironmentInput(path: string, cwd?: string): Promise<unknown> {
  const content =
    path === "-"
      ? await readStandardInput()
      : await readFile(resolve(cwd ?? process.cwd(), path), "utf8")
  try {
    return JSON.parse(content)
  } catch (error) {
    throw new Error(`Invalid environment JSON input: ${sanitizeError(error)}`)
  }
}

function renderEnvironmentAdditionPlan(plan: EnvironmentAdditionPlan): string {
  if (!plan.addition) return "No environment plan."
  return [
    `Environment plan ${plan.planId}`,
    table([
      {
        id: plan.addition.id,
        repositories: plan.addition.environment.repositories,
        defaultBranch: plan.addition.environment.checkout?.branch,
        branches: plan.addition.environment.checkout?.branches,
        provider: plan.addition.environment.provider,
      },
    ]),
    table(plan.actions),
    "Environment declaration does not switch branches; use astrail env checkout separately.",
  ].join("\n\n")
}

function renderEnvironmentAdditionApply(
  data: EnvironmentAdditionApplyData | { applied: false; plan: null },
): string {
  if (!data.plan) return ""
  if (!data.applied) return renderEnvironmentAdditionPlan(data.plan)
  return `Added environment ${data.environment?.id ?? data.plan.addition?.id ?? ""}.\nRun astrail env status <id>, then preview astrail env checkout <id> --dry-run separately.`
}

function renderEnvironmentStatus(
  status: NonNullable<Awaited<ReturnType<typeof getEnvironmentCheckoutStatus>>["data"]>,
): string {
  if (!status.configured) return `Environment ${status.environment} has no checkout configuration.`
  return [
    `Environment ${status.environment}: ${status.desiredBranch ? `default ${status.desiredBranch}` : "per-repository branches"} (${status.consistent ? "consistent" : "inconsistent"})`,
    table(status.repositories),
  ].join("\n\n")
}

function renderEnvironmentCheckoutPlan(plan: EnvironmentCheckoutPlan): string {
  return [
    `Environment checkout plan ${plan.planId}`,
    `Environment ${plan.environment}: ${plan.desiredBranch ? `default ${plan.desiredBranch}` : "per-repository branches (see actions)"}`,
    table(plan.actions),
  ].join("\n\n")
}

function renderEnvironmentCheckoutApply(data: EnvironmentCheckoutApplyData): string {
  if (!data.applied) return renderEnvironmentCheckoutPlan(data.plan)
  return `Checked out environment ${data.plan.environment} to its configured repository branches.\n\n${table(data.status?.repositories ?? [])}`
}

function addContextCommands(program: Command, writer: OutputWriter): void {
  const context = program.command("context").description("inspect and load workspace context")
  context.command("list").action(async (_options: unknown, command: Command) => {
    await execute(
      "context list",
      command,
      writer,
      async (global) => {
        const workspace = await resolveWorkspace(global)
        return result(workspace.contexts, workspace.diagnostics)
      },
      (contexts) => table(contexts),
    )
  })
  context
    .command("show")
    .argument("<id>")
    .action(async (id: string, _options: unknown, command: Command) => {
      await execute("context show", command, writer, async (global) => {
        const workspace = await resolveWorkspace(global)
        const source = workspace.contexts.find((item) => item.id === id)
        return result(
          source ?? null,
          source
            ? workspace.diagnostics
            : [...workspace.diagnostics, diagnostic("ASTR8006", "error", `Unknown context ${id}`)],
        )
      })
    })
  context
    .command("load")
    .argument("<id>")
    .action(async (id: string, _options: unknown, command: Command) => {
      await execute<ContextLoadData>("context load", command, writer, async (global) => {
        const workspace = await resolveWorkspace(global)
        const source = workspace.contexts.find((item) => item.id === id)
        if (!source) {
          return result({ context: null }, [
            ...workspace.diagnostics,
            diagnostic("ASTR8006", "error", `Unknown context ${id}`),
          ])
        }
        const loaded = await loadContextContent(source)
        return result(
          {
            context: source,
            ...(loaded.content !== undefined ? { content: loaded.content } : {}),
            ...(loaded.files !== undefined ? { files: loaded.files } : {}),
          },
          [...workspace.diagnostics, ...loaded.diagnostics],
        )
      })
    })
}

function addCapabilityCommands(program: Command, writer: OutputWriter): void {
  const capability = program.command("capability").description("inspect resolved capabilities")
  capability.command("list").action(async (_options: unknown, command: Command) => {
    await execute(
      "capability list",
      command,
      writer,
      async (context) => {
        const workspace = await resolveWorkspace(context)
        const resolution = await resolveCapabilities(
          workspace.config,
          workspace.root,
          workspace.provenance,
          resolvedRepositoryPaths(workspace),
        )
        return result(
          { ...resolution, builtins: [EDITOR_CAPABILITY] },
          uniqueDiagnostics([...workspace.diagnostics, ...resolution.diagnostics]),
        )
      },
      (resolution) =>
        `${table(resolution.capabilities)}\n\nBuilt-in commands\n${table(resolution.builtins, ["id", "description", "discovery"])}`,
    )
  })
  capability
    .command("resolve")
    .argument("[name]")
    .action(async (name: string | undefined, _options: unknown, command: Command) => {
      await execute("capability resolve", command, writer, async (context) => {
        const workspace = await resolveWorkspace(context)
        const resolution = await resolveCapabilities(
          workspace.config,
          workspace.root,
          workspace.provenance,
          resolvedRepositoryPaths(workspace),
        )
        const selected = name
          ? resolution.capabilities.filter(
              (item) => item.id === name || item.identity === name || item.exposeAs === name,
            )
          : resolution.capabilities
        const diagnostics = uniqueDiagnostics([...workspace.diagnostics, ...resolution.diagnostics])
        if (name && selected.length === 0)
          diagnostics.push(diagnostic("ASTR8005", "error", `Unknown capability ${name}`))
        return result(
          { capabilities: selected, recommendations: resolution.recommendations },
          diagnostics,
        )
      })
    })
}

function addProjectionCommands(program: Command, writer: OutputWriter): void {
  program
    .command("render")
    .description("preview enabled target projections")
    .action(async (_options: unknown, command: Command) => {
      await execute(
        "render",
        command,
        writer,
        async (context) => {
          const workspace = await resolveWorkspace(context)
          const plan = await planWorkspaceProjections(workspace)
          return result(plan, [...workspace.diagnostics, ...plan.diagnostics])
        },
        (plan) => table(plan.changePlan.actions),
      )
    })
  program
    .command("sync", { hidden: true })
    .description("deprecated: synchronize projections only; use install for the full workflow")
    .option("--dry-run", "preview without writing")
    .option("--yes", "authorize remote capability acquisition")
    .action(async (options: { dryRun?: boolean; yes?: boolean }, command: Command) => {
      await execute(
        "sync",
        command,
        writer,
        async (context) => {
          const workspace = await resolveWorkspace(context)
          const plan = await planWorkspaceProjections(workspace)
          const synced = await syncWorkspaceProjections(plan, {
            dryRun: options.dryRun === true,
            authorized: options.yes === true,
          })
          if (!synced.success) journalSkipStep("editor.sync", "blocked")
          const editorWorkspace = await syncEditorWorkspace(workspace, {
            dryRun: options.dryRun === true || !synced.success,
          })
          return result(
            { ...synced.data, editorWorkspace: editorWorkspace.data },
            uniqueDiagnostics([
              ...workspace.diagnostics,
              ...synced.diagnostics,
              ...editorWorkspace.diagnostics,
            ]),
          )
        },
        (plan) =>
          `${table(plan.changePlan.actions)}\n${renderEditorWorkspace(plan.editorWorkspace)}`,
      )
    })
}

function addLifecycleCommands(program: Command, writer: OutputWriter): void {
  for (const name of ["install", "bootstrap"] as const) {
    program
      .command(name, { hidden: name === "bootstrap" })
      .description(
        name === "install"
          ? "install workspace resources, lock resolutions and synchronize artifacts"
          : "compatibility alias for install",
      )
      .option("--dry-run", "preview local actions without network access or writes")
      .option("--yes", "authorize remote acquisition and repository preparation")
      .action(async (options: { dryRun?: boolean; yes?: boolean }, command: Command) => {
        await execute(
          name,
          command,
          writer,
          (context) => installWorkspace(context, options),
          (data) => renderBootstrap(data, name === "bootstrap" ? "Bootstrap" : "Install"),
        )
      })
  }
  program
    .command("lock", { hidden: true })
    .option("--dry-run", "preview without writing")
    .action(async (options: { dryRun?: boolean }, command: Command) => {
      await execute(
        "lock",
        command,
        writer,
        async (context) => {
          const workspace = await resolveWorkspace(context)
          const projection = await planWorkspaceProjections(workspace)
          const plan = await planLock(workspace, {
            acquisitions: workspaceGitResolutions(projection),
          })
          const applied = await applyFilePlan(workspace.root, plan, {
            dryRun: options.dryRun === true,
          })
          return result(applied.data, [...workspace.diagnostics, ...applied.diagnostics])
        },
        (plan) => table(plan.actions),
      )
    })
  program
    .command("update")
    .description("refresh remote dependencies, lock resolutions and synchronize artifacts")
    .option("--dry-run", "preview sources to check without network access or writes")
    .option("--yes", "authorize remote dependency refresh")
    .option("--restore", "compatibility: restore the previous lock state only")
    .action(
      async (options: { dryRun?: boolean; yes?: boolean; restore?: boolean }, command: Command) => {
        await execute<
          Partial<WorkspaceInstallData> & { restored: boolean; plan: ChangePlan | null }
        >("update", command, writer, async (context) => {
          if (options.restore) {
            const loaded = await loadWorkspace(context)
            if (options.dryRun) return result({ restored: false, plan: null })
            const restored = await restorePreviousLock(loaded.root)
            return result({ restored: restored.data.restored, plan: null }, restored.diagnostics)
          }
          const installed = await installWorkspace(context, { ...options, update: true })
          return result(
            { ...installed.data, restored: false, plan: installed.data.lock ?? null },
            installed.diagnostics,
          )
        })
      },
    )
}

function renderBootstrap(data: CliBootstrapData, label = "Install"): string {
  const actions = [
    ...data.bootstrap.flatMap((plan) => plan.actions),
    ...(data.projection?.changePlan.actions ?? []),
    ...(data.editorWorkspace?.plan.actions ?? []),
    ...(data.lock?.actions ?? []),
  ]
  const sections = [
    `${label} actions`,
    table(actions),
    "Repository Skills",
    table([
      {
        discovered: data.repositorySkills.discovered,
        imported: data.repositorySkills.imported,
        unimported: data.repositorySkills.unimported,
        importable: data.repositorySkills.importable,
      },
    ]),
  ]
  if (data.repositorySkills.unimported > 0) {
    sections.push(
      table(
        data.repositorySkills.candidates.map((candidate) => ({
          repository: candidate.repository,
          path: candidate.path,
          name: candidate.name,
          alias: candidate.proposedAlias,
          trusted: candidate.instructionsTrusted,
          importable: candidate.importable,
        })),
      ),
    )
  }
  if (data.setup.length)
    sections.push(
      "Config setup (Agent handoff; not executed by the CLI)",
      table(
        data.setup.map((entry) => ({
          config: entry.config,
          mode: entry.mode,
          status: entry.status,
          skill: entry.skill ?? "",
          alias: entry.alias ?? "",
          path: entry.path ?? "",
        })),
      ),
      data.setup.some((entry) => entry.status === "available")
        ? SETUP_HANDOFF_INSTRUCTION
        : "Setup is not ready to execute. Planned entries are preview only; resolve blocked entries before completing initialization.",
    )
  if (data.editorWorkspace) sections.push(renderEditorWorkspace(data.editorWorkspace))
  return sections.join("\n\n")
}

function addJournalCommands(program: Command, writer: OutputWriter): void {
  const journal = program
    .command("journal")
    .description("inspect retained local workspace operation history")
  journal
    .command("list")
    .option("--limit <count>", "maximum operations to show (default: 20)")
    .option("--repo <id>", "filter by repository ID")
    .option("--environment <id>", "filter by environment ID")
    .option("--since <date>", "ISO date (UTC midnight) or timestamp with timezone")
    .action(
      async (
        options: { limit?: string; repo?: string; environment?: string; since?: string },
        command: Command,
      ) => {
        await execute(
          "journal list",
          command,
          writer,
          async (context) => {
            const { root } = await discoverWorkspaceRoot(context.cwd, context.config)
            const { limit, ...filters } = options
            return listJournal(root, {
              ...filters,
              ...(limit !== undefined
                ? { limit: /^\d+$/.test(limit) ? Number(limit) : Number.NaN }
                : {}),
            })
          },
          renderJournal,
        )
      },
    )
  journal
    .command("show <operation-id>")
    .description("show an operation and its completed changes")
    .action(async (operationId: string, _options: unknown, command: Command) => {
      await execute(
        "journal show",
        command,
        writer,
        async (context) => {
          const { root } = await discoverWorkspaceRoot(context.cwd, context.config)
          return showJournal(root, operationId)
        },
        renderJournalOperation,
      )
    })
}

async function execute<T>(
  name: string,
  command: Command,
  writer: OutputWriter,
  operation: (context: CommandContext) => Promise<Result<T>>,
  human: (data: T) => string = (data) => JSON.stringify(data, null, 2),
): Promise<void> {
  const startedAt = Date.now()
  const globals = command.optsWithGlobals<GlobalOptions>()
  const context: CommandContext = {
    json: globals.json === true,
    ...(globals.cwd ? { cwd: globals.cwd } : {}),
    ...(globals.config ? { config: globals.config } : {}),
  }
  const journalWarnings: Diagnostic[] = []
  try {
    if (name !== "init") {
      await requireWorkspaceRuntime({ ...context, command: name }, CLI_VERSION)
    }
    const operationResult = await executeWithJournal(
      name,
      context,
      command.opts(),
      CLI_VERSION,
      () => operation(context),
      (warning) => journalWarnings.push(warning),
    )
    const root =
      "root" in Object(operationResult.data) &&
      typeof Object(operationResult.data).root === "string"
        ? String(Object(operationResult.data).root)
        : undefined
    emitResult({
      command: name,
      result: operationResult,
      json: context.json,
      writer,
      startedAt,
      ...(root ? { workspaceRoot: root } : {}),
      human,
    })
  } catch (error) {
    if (error instanceof RuntimeCompatibilityError) {
      emitResult({
        command: name,
        result: error.inspection,
        json: context.json,
        writer,
        startedAt,
        workspaceRoot: error.inspection.data.root,
        human: () => "",
      })
      return
    }
    const failure = result(null, [
      diagnostic("ASTR9001", "error", sanitizeError(error), {
        remediation: "Run with a valid workspace path or inspect the preceding diagnostic.",
      }),
      ...journalWarnings,
    ])
    emitResult({
      command: name,
      result: failure,
      json: context.json,
      writer,
      startedAt,
      human: () => "",
    })
    process.exitCode = CLI_EXIT_CODES.runtime
  }
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

function renderRepositories(
  repositories: Awaited<ReturnType<typeof resolveWorkspace>>["topology"]["repositories"],
): string {
  return table(
    repositories.map((repository) => ({
      id: repository.id,
      role: normalizeRepositoryMetadata(repository.role),
      description: normalizeRepositoryMetadata(repository.description) ?? "not declared",
      source: repository.source.type,
      path: repository.path,
      access: repository.access,
      required: repository.required,
      observed: repository.observation?.present,
    })),
  )
}

function normalizeRepositoryMetadata(value: string | undefined): string | undefined {
  const normalized = value?.replaceAll(/\s+/g, " ").trim()
  return normalized || undefined
}

async function describeRuntime(workspace: ResolvedWorkspace): Promise<void> {
  const executable = fileURLToPath(new URL("./index.js", import.meta.url))
  workspace.runtime.executable = executable
  workspace.runtime.source = (await isWorkspaceRuntime(workspace.root, executable))
    ? "local"
    : "launcher"
}

function renderWorkspaceStatus(workspace: CliWorkspaceStatus): string {
  return [
    "Runtime",
    table([workspace.runtime]),
    "Repositories",
    renderRepositories(workspace.topology.repositories),
    "Environments",
    table(
      workspace.environmentStatuses.map((environment) => ({
        environment: environment.environment,
        configured: environment.configured,
        defaultBranch: environment.desiredBranch,
        branches: Object.fromEntries(
          environment.repositories.map((repository) => [
            repository.repository,
            repository.desiredBranch,
          ]),
        ),
        state: environment.configured
          ? environment.consistent
            ? "consistent"
            : "inconsistent"
          : "resource-only",
        repositories: environment.repositories.length,
      })),
    ),
    "Capabilities",
    table(
      workspace.capabilities.map((capability) => ({
        id: capability.id,
        kind: capability.kind,
        alias: capability.exposeAs,
        source: capability.source.type,
        active: capability.active,
        path: capability.path,
      })),
    ),
    ...Object.entries(workspace.projections).flatMap(([target, health]) => [
      `${target === "codex" ? "Codex" : "CodeBuddy"} projection`,
      table([
        {
          state: health.current ? "current" : "needs-sync",
          manifest: health.manifestPresent,
          artifacts: health.artifacts.length,
          pending: health.pendingActions.length,
        },
      ]),
    ]),
  ].join("\n\n")
}

function renderDoctor(data: CliDoctorData): string {
  const sections = [
    `Workspace health: ${data.root}`,
    "Tools",
    table([
      {
        astrail: data.tools.astrail,
        astrailSupported: data.tools.astrailSupported,
        node: data.tools.node,
        nodeSupported: data.tools.nodeSupported,
        git: data.tools.git,
      },
    ]),
    "Summary",
    table([
      {
        repositories: data.workspace.topology.repositories.length,
        environments: data.workspace.environmentStatuses.length,
        capabilities: data.workspace.capabilities.length,
        unimportedSkills: data.repositorySkills.unimported,
        ...Object.fromEntries(
          Object.entries(data.projections).map(([target, health]) => [
            target,
            health.current ? "current" : "needs-sync",
          ]),
        ),
        pending: Object.values(data.projections).reduce(
          (count, health) => count + health.pendingActions.length,
          0,
        ),
      },
    ]),
  ]
  if (data.repositorySkills.unimported > 0) {
    sections.push(
      "Unimported repository Skills",
      table(
        data.repositorySkills.candidates.map((candidate) => ({
          repository: candidate.repository,
          path: candidate.path,
          name: candidate.name,
          alias: candidate.proposedAlias,
          trusted: candidate.instructionsTrusted,
          importable: candidate.importable,
        })),
      ),
    )
  }
  return sections.join("\n\n")
}

function resolvedRepositoryPaths(
  workspace: Awaited<ReturnType<typeof resolveWorkspace>>,
): ReadonlyMap<string, string> {
  return new Map(
    workspace.topology.repositories.flatMap((repository) =>
      repository.path ? ([[repository.id, repository.path]] as const) : [],
    ),
  )
}

function uniqueDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return diagnostics.filter((item) => {
    const key = JSON.stringify(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function escalateWarnings(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.map((item) =>
    item.severity === "warning" ? { ...item, severity: "error" as const } : item,
  )
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replaceAll(/(password|token|secret|credential)\s*[:=]\s*\S+/gi, "$1=<redacted>")
}
