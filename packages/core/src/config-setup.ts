import {
  type ConfigSetupEntry,
  type Diagnostic,
  diagnostic,
  type LoadedConfig,
  type ResolvedCapability,
} from "./types.js"

export function resolveConfigSetups(
  configs: LoadedConfig[],
  capabilities: ResolvedCapability[],
): { entries: ConfigSetupEntry[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  const entries: ConfigSetupEntry[] = []
  for (const config of configs) {
    if (!config.available || config.setup?.mode !== "skill") continue
    const skill = config.setup.skill
    const matches = capabilities.filter((item) => item.identity === skill && item.kind === "skill")
    const capability = matches.length === 1 ? matches[0] : undefined
    if (!capability) {
      diagnostics.push(
        diagnostic(
          "ASTR1114",
          configs.some((item) => !item.available) ? "warning" : "error",
          `Config ${config.manifestPath} setup must reference one enabled Skill: ${skill}`,
          {
            remediation: "Declare the setup Skill capability, or omit setup if no setup is needed.",
          },
        ),
      )
    } else if (!capability.active) {
      diagnostics.push(
        diagnostic("ASTR1115", "warning", `Config ${config.manifestPath} setup Skill is inactive`, {
          remediation: "Review the Skill instruction trust before projecting its setup entry.",
        }),
      )
    }
    entries.push({
      config: config.manifestPath,
      mode: "skill",
      skill,
      status: capability?.active ? "pending" : "blocked",
      ...(capability ? { alias: capability.exposeAs } : {}),
    })
  }
  return { entries, diagnostics }
}
