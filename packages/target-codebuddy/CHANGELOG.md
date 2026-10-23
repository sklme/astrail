# target-codebuddy

## 0.15.0

- Support typed shared configuration inputs through `extends.with`, explicit forwarding, binding inspection, and stale-input protection.
- Automatically maintain exact generated Skill paths in target-local `.gitignore` files while preserving user rules and source Skills.


## 0.14.0

### Minor Changes

- Support CodeBuddy IDE as an optional projection target alongside Codex, including initialization, workspace rules, Skills, target health, shared Git acquisition and setup resources, and transaction rollback. Retain the existing Codex API and ownership manifest; package the projection engine and built-in Skills once for both adapters.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - astrail-core@0.14.0
  - astrail-target-shared@0.14.0
