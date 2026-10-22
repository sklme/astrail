import type { ResolvedWorkspace, Result } from "astrail-core"
import type {
  ProjectionHealth,
  ProjectionManifest as SharedProjectionManifest,
} from "astrail-target-shared"
import { createProjectionTarget } from "astrail-target-shared"

export type {
  GitProjectionAcquisition,
  ProjectionArtifact,
  ProjectionOwnership,
  ProjectionOwnershipRule,
  ProjectionPlan as CodexProjectionPlan,
} from "astrail-target-shared"

export const {
  SKILLS_DIRECTORY: CODEX_SKILLS_DIRECTORY,
  CONFIG_SETUPS_DIRECTORY,
  ASTRAIL_EDITOR_SKILL,
  ASTRAIL_ENVIRONMENTS_SKILL,
  ASTRAIL_INSPECTION_SKILL,
  ASTRAIL_REPOSITORIES_SKILL,
  ASTRAIL_SKILLS_SKILL,
  MANAGED_BEGIN,
  MANAGED_END,
  planProjection: planCodexProjection,
  syncProjection: syncCodexProjection,
  doctorProjection,
  gitCapabilityResolutions,
  renderManagedInstructions,
  updateManagedRegion,
  projectionManifestPath,
} = createProjectionTarget({
  id: "codex",
  skillsDirectory: ".agents/skills",
  instructionsPath: "AGENTS.md",
  manifestPath: ".astrail/projection-manifest.json",
})

// Keep the public Codex API's literal manifest type for existing consumers.
export type ProjectionManifest = Omit<SharedProjectionManifest, "target"> & { target: "codex" }
export type CodexProjectionHealth = Omit<ProjectionHealth, "manifest"> & {
  manifest?: ProjectionManifest
}
export const doctorCodexProjection = doctorProjection as (
  workspace: ResolvedWorkspace,
) => Promise<Result<CodexProjectionHealth>>
