# Design

Resolve filenames in the core planner so sync, onboarding, and open share one rule. Explicit configuration remains authoritative, including validation failures. Inferred candidates must satisfy the existing filename constraint; no path components or display labels are used as filenames. The Schema describes the dynamic default instead of advertising a constant default.

When the inferred destination does not exist and the ownership state tracks the legacy filename, use its JSONC and folder ownership as the source. Preserve all user content and reconcile only owned folder entries. Retain the source and its ownership state; existing destinations take precedence. Refuse unsafe or malformed legacy sources using the existing destination and JSONC guards. Include the source as an unchanged read in the plan so stale-plan checks cover migration without writing it.

Fallback naming is defensive and does not bypass manifest diagnostics. Users can pin the legacy name through editor.workspaceFile. Changes are previewable through the existing dry-run workflow; no deletion, IDE launch, or publication is introduced.
