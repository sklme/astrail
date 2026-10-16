## 1. Remove the unused importer

- [x] 1.1 Remove the CLI registration, core implementation and export, compatibility fixtures, and importer-specific test in both distributions.
- [x] 1.2 Clean up obsolete design references and internal command documentation, and add a release changeset.

## 2. Verify the remaining behavior

- [x] 2.1 Run full repository checks and strict validation of this change in both distributions.
- [x] 2.2 Verify that the removed command is rejected, normal workspace setup and Skill import remain available, and no obsolete generated modules remain in package contents.
- [x] 2.3 Build the internal documentation site and review the final diffs for unrelated changes.
