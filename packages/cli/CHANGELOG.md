# @jgalego/teamapi

## 0.4.0

### Minor Changes

- ca583e4: Add a `generate agents-md` target: one AGENTS.md per repository, rendered from the
  team that owns the service in it — ownership, the bounded context's ubiquitous
  language, domain events, policies and steering documents. Policies and steering
  are reproduced verbatim rather than summarised, so an agent reads what a reviewer
  would quote back.
- 6c77ac6: Add a `generate codeowners` target: one CODEOWNERS file per repository, owned by
  the team that declares the service. Owners are written as `@org/team-id` with
  `--org`, or as members' `githubUsername` handles without it. A repository claimed
  by two teams is reported as a conflict and exits non-zero rather than being
  assigned to whichever team sorted first.
- ee64909: Add `teamapi doctor <github|slack|pagerduty|okta>`, which verifies a live
  integration: authentication, the read, the field shapes the drift checks depend
  on, and whether pagination is actually followed. The pagination check asks for one
  item per page and counts what comes back, so it needs no large account and reports
  `skip` rather than a pass when there is nothing to page through. Each client gains
  a `verify()` so a rejected token can no longer be mistaken for an empty account.
  Read-only; exits 1 on any failing check.
- 42d5982: Add an `okta-drift` command reconciling declared `members[]` against an Okta
  directory group. Only a `deactivated` finding exits non-zero — a member whose
  account is no longer active but who is still listed, and therefore still reads as
  an owner to everything downstream. Joiners and leavers are reported as warnings.
  Read-only: nothing is written back to `teamapi.yml`.
- 551234a: Add a `generate otel` target: ownership as OpenTelemetry resource attributes, so
  traces, metrics and alerts attribute themselves to a team. Emits one `.env` per
  service holding an `OTEL_RESOURCE_ATTRIBUTES` line, and a collector `transform`
  processor that stamps the same attributes centrally. Values are percent-encoded,
  since the variable is W3C Baggage and a comma in a team name would otherwise
  truncate the list.
- 6eff7a3: Add a `pagerduty-drift` command reporting where PagerDuty and the declared org
  graph disagree about who gets paged. Only an `unresponsive` finding — a declared
  service with no escalation policy, or one with nobody on it — exits non-zero, so
  it can gate a required check without ordinary drift failing the build. Read-only
  in both directions.
- 9c426a5: Move Paperclip's HTTP out of `paperclip-drift` into a `PaperclipClient`, matching
  the other four providers, and add `teamapi doctor paperclip`. Its `verify()`
  separates a refused token from a company id that doesn't exist — two outcomes that
  need different fixes and previously arrived as the same error. The doctor report
  also shows how many running agents carry `metadata.teamapi`, since the rest fall
  back to slug matching.
- 1f8b769: Add a Paperclip integration: a `generate paperclip` target emitting an
  `agentcompanies/v1` package, and a `paperclip-drift` command that reports where a
  running Paperclip company diverges from the declared org graph.
- fe754b3: Add a `generate port` target emitting a Port catalog as `blueprints.json` and
  `entities.json` — a team, service and person blueprint, with services related to
  their owning team. Unlike the Backstage target it carries `cognitiveLoad` and its
  label, which Port can score, threshold and alert on.
- e96acc8: Add a Slack integration: a `/whoowns` slash-command endpoint on the REST API,
  mounted only when `SLACK_SIGNING_SECRET` is set and verifying Slack's request
  signature in constant time with a five-minute replay window; and a `slack-sync`
  command that sets each declared channel's topic to name the owning team, with the
  same plan/apply split as `teamapi apply`.

### Patch Changes

- c411166: Move the PagerDuty and Okta HTTP calls out of their CLI commands into
  `PagerDutyClient` and `OktaClient`, alongside the existing GitHub and Slack
  clients, and cover all three against a stubbed fetch: auth schemes, pagination
  contracts, and the failure modes that would otherwise read as an empty result.
  Okta's link-following now refuses to revisit a page, so a malformed `Link` header
  can't loop forever.
- Updated dependencies [ca583e4]
- Updated dependencies [6c77ac6]
- Updated dependencies [ee64909]
- Updated dependencies [c411166]
- Updated dependencies [42d5982]
- Updated dependencies [551234a]
- Updated dependencies [6eff7a3]
- Updated dependencies [9c426a5]
- Updated dependencies [1f8b769]
- Updated dependencies [fe754b3]
- Updated dependencies [e96acc8]
  - @jgalego/teamapi-core@0.6.0
  - @jgalego/teamapi-rest-api@0.4.0
  - @jgalego/teamapi-chat@0.1.7
  - @jgalego/teamapi-mcp-server@0.3.2

## 0.3.2

### Patch Changes

- ed56c2e: Stop shipping each package's own compiled test suite (`dist/__tests__/**`) in the published npm tarball — `tsc -b` was compiling `src/**/*.test.ts` alongside real source since nothing excluded it, and `"files": ["dist"]` then published the result. Cuts `@jgalego/teamapi-core`'s published file count by about 40% with no change in behavior; `pnpm test` is unaffected since Vitest runs the `.ts` sources directly rather than the built output.

  Rename a local variable in the CrewAI generator from `process` to `crewProcess` (the object's `process` field, matching CrewAI's own config shape, is unchanged) — a variable literally named `process` was tripping supply-chain scanners' "environment variable access" heuristic even though this code never touches `process.env` or any other global.

- Updated dependencies [ed56c2e]
  - @jgalego/teamapi-schema@0.4.1
  - @jgalego/teamapi-core@0.5.1
  - @jgalego/teamapi-rest-api@0.3.1
  - @jgalego/teamapi-mcp-server@0.3.1
  - @jgalego/teamapi-chat@0.1.6

## 0.3.1

### Patch Changes

- Updated dependencies [b3c64e3]
  - @jgalego/teamapi-schema@0.4.0
  - @jgalego/teamapi-core@0.5.0
  - @jgalego/teamapi-rest-api@0.3.0
  - @jgalego/teamapi-mcp-server@0.3.0
  - @jgalego/teamapi-chat@0.1.5

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
