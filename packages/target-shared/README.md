# astrail-target-shared

Shared projection engine and built-in Skills used by Astrail target adapters.

Skill projection sync maintains an exact-path managed block in each target's
`skills/.gitignore`. Commit these ignore files alongside the workspace manifest,
lockfile and locally maintained Skill sources; generated links and copies can be
recreated with `astrail install`. User-authored rules and unrelated Skills are
preserved. Manifest-only entries are not ignored. Dry-run includes ignore-file
changes without writing them. Existing tracked projections remain tracked until
the user explicitly removes them from the Git index; sync never changes the index.
