import { createProjectionTarget } from "astrail-target-shared"

export type {
  ProjectionHealth as CodeBuddyProjectionHealth,
  ProjectionPlan as CodeBuddyProjectionPlan,
} from "astrail-target-shared"
export const {
  planProjection: planCodeBuddyProjection,
  syncProjection: syncCodeBuddyProjection,
  doctorProjection: doctorCodeBuddyProjection,
  projectionManifestPath,
} = createProjectionTarget({
  id: "codebuddy",
  skillsDirectory: ".codebuddy/skills",
  instructionsPath: ".codebuddy/rules/astrail/RULE.mdc",
  manifestPath: ".astrail/projections/codebuddy.json",
})
