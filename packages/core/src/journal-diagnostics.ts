import type { Diagnostic, DiagnosticSeverity, SourceLocation } from "./types.js"

export interface JournalDiagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  remediation: string
  messageSource: "catalog" | "fallback"
  location?: SourceLocation
}

// Deliberately separate from CLI diagnostic text: messages and remediation may
// contain YAML values, URLs, subprocess stderr or exception text. Only reviewed
// templates and typed numeric context may enter persistent history.
const explanations: Record<string, [message: string, remediation: string]> = {
  ASTR1101: [
    "A shared config source is invalid or could not be loaded.",
    "Check its source, path and format, then retry resolution.",
  ],
  ASTR1102: [
    "A shared config is unavailable.",
    "Check local config paths, or review bootstrap to acquire missing remote configs.",
  ],
  ASTR1105: [
    "Shared config references contain a cycle.",
    "Remove the reference cycle before retrying.",
  ],
  ASTR1106: [
    "Shared config references request conflicting Git refs.",
    "Use a consistent ref for each config source.",
  ],
  ASTR1107: [
    "The shared config graph exceeds the depth or size limit.",
    "Reduce nested or repeated config references.",
  ],
  ASTR1201: [
    "An Astrail runtime requirement is invalid.",
    "Use a valid semver range in requires.astrail.",
  ],
  ASTR1202: [
    "The current Astrail runtime does not satisfy a requirement.",
    "Review the declared runtime range and select a compatible Astrail version.",
  ],
  ASTR1203: [
    "The Astrail runtime requirement could not be resolved.",
    "Inspect the runtime configuration and requirement declarations.",
  ],
  ASTR1104: [
    "Shared config integrity does not match the expected digest.",
    "Review the config source and lock before retrying bootstrap.",
  ],
  ASTR5001: [
    "Codex projection could not be planned.",
    "Inspect status and doctor, then preview sync again.",
  ],
  ASTR5002: [
    "A Skill source is unavailable.",
    "Check the Skill source and prepare it before syncing.",
  ],
  ASTR5003: [
    "Multiple Skills use the same Codex alias.",
    "Give the conflicting Skills distinct aliases.",
  ],
  ASTR5004: [
    "A Skill source is unavailable.",
    "Check the Skill source and prepare it before syncing.",
  ],
  ASTR5010: [
    "An unowned projection path would be replaced.",
    "Inspect the destination and resolve the ownership conflict before syncing.",
  ],
  ASTR5011: [
    "Git Skill acquisition requires authorization.",
    "Review astrail sync --dry-run before applying with --yes.",
  ],
  ASTR5012: [
    "An acquired Skill does not match locked integrity.",
    "Review the remote change before updating the lock.",
  ],
  ASTR5013: [
    "Git Skill acquisition failed.",
    "Check source access, revision and integrity, then retry sync.",
  ],
  ASTR5028: [
    "Shared configs are unavailable for projection.",
    "Complete bootstrap before syncing projections.",
  ],
  ASTR5029: [
    "A legacy setup projection was modified.",
    "Review and preserve local edits before migrating the setup.",
  ],
  ASTR5030: [
    "The retired records Skill has local modifications.",
    "Preserve local changes before removing its projection.",
  ],
  ASTR6101: [
    "A required repository has no local path.",
    "Review repository configuration and local overrides.",
  ],
  ASTR6103: [
    "Bootstrap requires authorization.",
    "Review astrail bootstrap --dry-run before applying with --yes.",
  ],
  ASTR6105: [
    "Bootstrap discovered repository Skills that are not imported.",
    "Review astrail skill discover --all, select Skills to import, then preview astrail sync --dry-run.",
  ],
  ASTR6106: [
    "Shared config acquisition failed.",
    "Check source access, ref, config path, YAML, runtime requirement and integrity, then retry bootstrap.",
  ],
  ASTR6107: [
    "Bootstrap exceeded the config acquisition depth limit.",
    "Review the config reference graph before retrying.",
  ],
  ASTR6201: [
    "The planned operation requires authorization.",
    "Review the dry-run plan before applying with --yes.",
  ],
  ASTR6202: [
    "No previous lock state is available.",
    "Inspect the current lock; there is no recorded lock state to restore.",
  ],
  ASTR6204: [
    "An unavailable config cannot be locked.",
    "Prepare the shared config before creating the lock.",
  ],
  ASTR7007: [
    "The repository plan does not match the reviewed plan.",
    "Preview repository addition again and use the returned plan ID.",
  ],
  ASTR7305: [
    "An environment checkout has local changes.",
    "Review and preserve local changes before switching branches.",
  ],
  ASTR7307: [
    "Environment checkout requires authorization.",
    "Review the checkout dry-run before applying with --yes.",
  ],
  ASTR7308: [
    "The checkout plan does not match the reviewed plan.",
    "Preview checkout again and use the returned plan ID.",
  ],
  ASTR7309: [
    "The environment checkout plan is stale.",
    "Inspect current state and preview checkout again.",
  ],
  ASTR7310: [
    "A repository branch switch failed.",
    "Inspect the recorded completed, failed and pending repositories before retrying.",
  ],
  ASTR7311: [
    "Environment checkout failed final verification.",
    "Verify repository branches with status before retrying.",
  ],
  ASTR7312: [
    "Environment checkout failed.",
    "Inspect current branches and retained changes before retrying.",
  ],
  ASTR7401: [
    "The editor workspace filename is invalid.",
    "Choose a supported .code-workspace filename.",
  ],
  ASTR7402: [
    "A repository is unavailable to the editor workspace.",
    "Prepare the repository and synchronize the editor workspace again.",
  ],
  ASTR7403: [
    "The editor workspace could not be prepared.",
    "Inspect destination paths and permissions, then preview editor sync.",
  ],
  ASTR7404: [
    "Editor files changed after preview.",
    "Run astrail editor sync --dry-run again before retrying.",
  ],
  ASTR7405: [
    "Editor synchronization failed.",
    "Check destination permissions and retry editor sync; completed repository work is retained.",
  ],
  ASTR8014: [
    "The repository contains Skills that are not imported.",
    "Review astrail skill discover and selectively import repository Skills.",
  ],
  ASTR8102: [
    "Workspace files were created, but dependency installation failed.",
    "Resolve the installer error and install dependencies in the workspace; rerunning init is unnecessary.",
  ],
  ASTR9001: [
    "The operation threw an exception.",
    "Inspect status and doctor before retrying; raw exception text is not retained.",
  ],
}

export function summarizeJournalDiagnostic(item: Diagnostic): JournalDiagnostic {
  const explanation = explanations[item.code]
  let message = explanation?.[0] ?? "Diagnostic text was not retained for this code."
  if (item.code === "ASTR6105") {
    const inventory = item.details?.repositorySkills
    const count =
      inventory && typeof inventory === "object" && "unimported" in inventory
        ? inventory.unimported
        : undefined
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0)
      message = `Bootstrap discovered ${count} repository Skill${count === 1 ? "" : "s"} that ${count === 1 ? "is" : "are"} not imported.`
  }
  return {
    code: item.code,
    severity: item.severity,
    message,
    remediation:
      explanation?.[1] ?? "Inspect the command diagnostics and current status for details.",
    messageSource: explanation ? "catalog" : "fallback",
    ...(item.location ? { location: item.location } : {}),
  }
}
