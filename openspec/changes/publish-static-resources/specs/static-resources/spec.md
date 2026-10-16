# Spec Delta

## ADDED Requirements

### Requirement: Versioned Schema delivery

Astrail SHALL export a catalog of its packaged Schema files. Schema IDs and newly generated schema download URLs SHALL use https://sklme.github.io/astrail/schema/. Runtime validation SHALL remain local.

#### Scenario: Initialize a workspace
- **WHEN** a Workspace is initialized
- **THEN** its schema URL points to the Pages JSON resource and apiVersion retains its protocol identity

### Requirement: Official template publication

Astrail SHALL publish templates separately from development examples. An empty official template catalog SHALL be valid. Nonempty catalogs MUST NOT be published without CLI compatibility validation.

#### Scenario: No official templates exist
- **WHEN** the template package is checked and packed
- **THEN** its catalog declares an empty template array and no example becomes a downloadable template

### Requirement: Documentation ownership

User documentation SHALL be maintained in astrail-page. Package READMEs SHALL link to the website and MUST NOT require runtime users to clone the documentation repository.

#### Scenario: Find the configuration reference
- **WHEN** a user reads a package README
- **THEN** the README links to the Pages configuration reference
