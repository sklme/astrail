## Configuration contract

Workspace `astrail.yaml` retains its required apiVersion/kind/metadata.name. Shared `astrail.config.yaml` uses the same business fields directly, with optional descriptive metadata and no kind/defaults wrapper. Schema generation derives the shared schema from the same definitions as the Workspace schema. Configuration overlays can omit inherited entity fields; the final effective Workspace is validated completely.

`extends` is an ordered array of local/HTTP strings or explicit `{local}`, `{http, integrity?}`, `{git, ref?, path?, integrity?}` objects. Git paths default to `astrail.config.yaml` and must stay inside the checkout. Relative local references in a Git config resolve to files within that Git checkout; local filesystem references resolve relative to the declaring file. HTTP configs are standalone: no local/adjacent resources. Unknown sources fail rather than being interpreted as builtins or npm.

## Composition and provenance

Traverse depth first in declaration order, dependencies before their parent. Apply each canonical config once; cycles are errors. A Git repository/file requested with different refs is a conflict. Source keys hash normalized source coordinates, excluding expected integrity. Cache Git checkouts by repository/ref and HTTP files by URL. Metadata is descriptive and cannot overwrite Workspace identity. Config requires constraints are independently checked and cannot be weakened by overrides. Ordinary objects merge, arrays replace; Workspace and personal overlays win. setup and extends are graph metadata, not ordinary inherited fields.

## Setup

Omission means no setup for that file and emits no diagnostic. Keep explicit mode:none valid. Resolve each declared setup against effective enabled/trusted Skills. Report its declaring config path, effective alias and absolute SKILL.md path. Shared config deduplication prevents repeated entries for the same config. Dependencies precede parent and Workspace entries. CLI never interprets or executes a Skill and does not infer successful onboarding.

## Acquisition, safety and locks

Read-only inspection/dry-run do not download or clone. Bootstrap previews explicit acquisitions; authorization permits bounded HTTP download or Git acquisition. Validate config/schema/runtime/digest before committing downloaded files or temporary Git checkouts. Failed acquisitions leave no usable partial cache. Reject credentials in HTTP URLs, unsafe Git paths, checkout escape through symlinks, unsupported old declarations and cyclic references. Limit graph depth/size to produce bounded diagnostics.

Locks contain normalized config sources, file digest and resolved Git commit. Re-acquisition honors matching locks. Changing a source coordinate creates a distinct key and cannot reuse the old resolution. Cache drift is reported. Metadata versions do not select Git refs. Skill locks and trust semantics remain independent.

## Delivery

Develop and test against the repository CLI; the parent Workspace remains on its existing 0.5.0 installation. Bump the fixed package group to 0.8.0 using Changesets and preview new Pages resources from local packages. Keep the site build usable against retained published packages, without pretending an unpublished 0.8.0 registry package exists.
