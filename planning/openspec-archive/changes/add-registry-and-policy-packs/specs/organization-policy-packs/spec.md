## ADDED Requirements

### Requirement: Organization policy packs remain advisory and attributable

Astrail SHALL compose namespaced organization policy packs as advisory rules with explicit version, source, compatibility, and field-level provenance.

#### Scenario: A policy pack reports a violation

- **WHEN** resolved or observed Workspace state violates an organization rule
- **THEN** Astrail reports the policy identity, provenance, severity, and remediation
- **AND** normal development remains unblocked unless the user explicitly requests strict evaluation
