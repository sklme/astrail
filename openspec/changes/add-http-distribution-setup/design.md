## Source model

Local sources identify a directory containing `astrail.distribution.yaml`. Git sources identify a repository with that entry at its root and an optional ref. HTTP sources identify one absolute HTTP(S) YAML URL; they cannot supply adjacent local files. Their capabilities use explicit remote Git sources (or builtins), and local file contexts/resources are rejected. URL changes select a different cache. Bootstrap reuses cached manifests; refreshing a moving URL is outside this change.

## Acquisition and trust

Read-only resolution never fetches. Authorized bootstrap downloads a bounded response with a timeout and bounded redirects, validates YAML/schema, single-file constraints, identity/version, and any expected digest before atomic cache publication. Errors leave the cache absent so retry works. Redirects cannot introduce credentials or downgrade HTTPS. Nested Distribution dependencies follow the same acquisition cycle. Plans show the URL and destination. A downloaded declaration is not executable approval; remote Skills still follow existing instruction trust and acquisition rules.

HTTP cache keys bind identity and URL. Status exposes source and SHA-256; lock entries bind identity, URL, version, and digest. A matching lock or explicit integrity detects changed cached or downloaded content. A changed URL is a new request and does not inherit a stale digest.

## Setup contract

New publications always declare `setup: { mode: skill, skill: publisher/setup }` or `setup: { mode: none }`. The `skill` value is canonical identity, resolved against effective capabilities after overrides; aliases may change. Missing/disabled/non-Skill references are diagnosed. Legacy omission is `unspecified`, with an informational diagnostic rather than a breaking schema requirement.

Bootstrap exposes each setup entry, projection availability, alias, and absolute SKILL.md path. Preview, blocked, available, none, and unspecified describe only handoff availability. There is no completed/authenticated state. The CLI never reads setup instructions as executable commands, never executes the Skill, and never collects credentials. The Agent uses the declared entry within the user's setup request.

## Compatibility

The new schema fields require an upgraded runtime. Existing manifests remain valid. Public additions ship as a minor release; documentation marks them unreleased until publication. No workspace-local runtime is silently upgraded.
