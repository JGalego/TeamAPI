# @jgalego/teamapi

## 0.3.0

### Minor Changes

- dbf75f6: Add `teamapi apply <patterns...> --org <github-org> [--yes]`: reconciles real GitHub teams and memberships with the resolved org graph, the way `terraform plan`/`apply` reconciles infrastructure. One GitHub team per Team API team (matched by slug === team id), members resolved via a new optional `Member.githubUsername` field. Always prints a plan first (`+ create team`, `+`/`- add`/`remove @user`, `!` for members with no `githubUsername` set) and only writes to GitHub when re-run with `--yes`. Exported from `@jgalego/teamapi-core` as `GithubClient`, `planGithubTeamsApply`, `formatApplyPlan`, and `executeGithubTeamsApply`.
- b73cbfd: Add `teamapi import github-org <org> --out <dir>`: bootstraps `teamapi.yml` documents from an existing GitHub org instead of hand-authoring every team from scratch — one `<team-id>/teamapi.yml` per GitHub team, with members enriched from GitHub user profiles (name, email, `githubUsername`) and `services[]` inferred from the team's repos. Every generated team defaults to `type: stream-aligned` with empty `roles[]`, since GitHub teams carry neither Team Topologies typing nor a role hierarchy — both are meant to be reviewed and corrected by hand. Exported from `@jgalego/teamapi-core` as `importGithubOrg`.

### Patch Changes

- Updated dependencies [dbf75f6]
- Updated dependencies [b73cbfd]
  - @jgalego/teamapi-schema@0.3.0
  - @jgalego/teamapi-core@0.4.0
  - @jgalego/teamapi-chat@0.1.4
  - @jgalego/teamapi-mcp-server@0.2.2
  - @jgalego/teamapi-rest-api@0.2.1

## 0.2.0

### Minor Changes

- df017b2: Add a Backstage catalog generator: `teamapi generate backstage <patterns...> [--team <id>] --out <dir>` turns the resolved org graph into a Backstage `catalog-info.yaml` — a `Group` per team (with its members), a `User` per member, and, for any team with `services[]`, a `System` grouping them plus a `Component` per service, owned by that team's `Group`. Exported from `@jgalego/teamapi-core` as `buildBackstageCatalog`/`buildBackstageOrgCatalog`/`toBackstageYaml`.
- 1a5ce98: Add org-history diffing: `teamapi diff <patterns...> --against <ref>` resolves the same patterns against the working tree and against a git revision (a branch, tag, or commit sha), then reports teams added/removed, per-team role/member/service changes, cognitive-load deltas, and edge changes (interactions, dependencies, cross-team reporting lines). Exported from `@jgalego/teamapi-core` as `diffOrgGraphs`/`isEmptyDiff`/`formatOrgGraphDiff`, independent of git — `teamapi diff` is what supplies "the org as of a revision" as one side of the comparison via a git-show-backed loader.

### Patch Changes

- Updated dependencies [df017b2]
- Updated dependencies [1a5ce98]
- Updated dependencies [5056af1]
  - @jgalego/teamapi-core@0.3.0
  - @jgalego/teamapi-rest-api@0.2.0
  - @jgalego/teamapi-chat@0.1.3
  - @jgalego/teamapi-mcp-server@0.2.1

## 0.1.2

### Patch Changes

- caebd20: Fixes from a full code + docs review:

  - **schema**: enforce previously-undocumented-but-unenforced rules — `roles[].id`/`members[].id`
    uniqueness, `reportsTo` must reference an existing role and can't form a cycle (including
    self-reports), `reportsTo`/`reportsToRef` are now genuinely mutually exclusive, and `x-*` vendor
    extension fields are preserved on `platform`/`reportsToRef`/`alignsWith[]` refs (previously
    silently stripped).
  - **core**: `detectConflicts` now also flags disagreeing `contextMappingPattern` declarations, not
    just disagreeing `mode`; a duplicate team id's own outbound `$ref`s are now still traversed so a
    team reachable only through the duplicate doesn't silently vanish from the graph;
    `findServiceOwner` picks a deterministic (alphabetically-first) owner when service names collide
    instead of an arbitrary graph-traversal-order one; fixed `HttpLoader.resolveUri` throwing
    "Invalid URL" when a local file references an absolute `https://` `$ref` directly; added
    `toOrgGraphDto` as the single shared serializer for "the full org graph" (now includes
    `roleEdges`, previously omitted from both REST's `/graph` and MCP's `get_org_graph`).
  - **cli**: `teamapi render`'s `--scope`/`--format` and `teamapi scaffold`'s `--type` now reject
    invalid values instead of silently falling back to a default; `--team` validation is now
    consistent across every `render` scope; `--port` is now validated as 1-65535; every command now
    warns (without failing) when the graph has unresolved references, not just `validate`;
    `teamapi chat` now caps tool-call iterations per turn, surfaces non-`end_turn` stop reasons
    instead of silently printing an empty/truncated reply, and shows minimal tool-call progress
    outside `--debug`; `--version` and `--model`'s default now track the real package
    version/`DEFAULT_CHAT_MODEL` instead of a hardcoded literal.
  - **rest-api**: `/graph` now includes `roleEdges`; added 400/404 response schemas to the OpenAPI
    spec; fixed `/search`'s inconsistent error body for a missing vs. empty `q`; the OpenAPI
    `info.version` now tracks the package's real version.
  - **mcp-server**: added a `get_team_dependencies` tool (previously only reachable via REST);
    `get_org_graph` now includes `roleEdges`; `find_service_owner`'s exact-match semantics are now
    disclosed in its description and error message; the reported server `version` now tracks the
    real package version instead of a hardcoded literal.
  - **chat**: pinned `zod` back to the same range as every sibling package (was on a different major
    than `core`/`schema`/`mcp-server`), while keeping `betaZodTool` working correctly by importing
    the `zod/v4` subpath explicitly — zod 3.25+ bundles both APIs in one package, so this eliminates
    two coexisting zod majors in the workspace without breaking the Anthropic SDK's zod helper.

- Updated dependencies [caebd20]
- Updated dependencies [82bbad4]
  - @jgalego/teamapi-schema@0.2.0
  - @jgalego/teamapi-core@0.2.0
  - @jgalego/teamapi-rest-api@0.1.2
  - @jgalego/teamapi-mcp-server@0.2.0
  - @jgalego/teamapi-chat@0.1.2

## 0.1.1

### Patch Changes

- e7703e1: Add a README to each published package so it renders on the npm listing page instead of showing "This package does not have a README."
- Updated dependencies [e7703e1]
  - @jgalego/teamapi-core@0.1.1
  - @jgalego/teamapi-schema@0.1.1
  - @jgalego/teamapi-rest-api@0.1.1
  - @jgalego/teamapi-mcp-server@0.1.1
  - @jgalego/teamapi-chat@0.1.1
