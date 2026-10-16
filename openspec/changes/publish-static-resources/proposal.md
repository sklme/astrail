# Proposal

## Why

Astrail needs one documentation and resource site with explicit versioned package boundaries.

## What Changes

- Move Schema IDs and emitted download URLs to sklme.github.io/astrail while retaining the independent apiVersion namespace.
- Export a Schema resource catalog and introduce an empty official template package.
- Move user documentation ownership to astrail-page; validate resources before publication.

## Capabilities

### New Capabilities

- static-resources: versioned Schema and template package delivery.

## Impact

Schema package, local/workspace authoring URLs, template package, Changesets and documentation links. CLI runtime validation continues to use bundled schemas without network access.
