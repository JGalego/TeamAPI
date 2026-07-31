# @jgalego/teamapi-core

## 0.7.0

### Minor Changes

- 7ca7e0c: Surface `cognitiveLoad.supervision` on the three places that were still blind to it:

  - **`teamapi diff`** tracks it as its own field on `CognitiveLoadSnapshot`. Because supervision
    sits outside `total` by design, a team whose supervision load doubled without touching the other
    three types previously reported no change at all — exactly the quiet growth the field exists to
    expose.
  - **The Port generator** emits `supervisionLoad` beside `cognitiveLoad`. Port scores and colours
    numeric properties, so "who is carrying the most agent-supervision load" becomes a sortable
    column instead of something you read four YAML files to learn.
  - **The dashboard** shows it as a separate 🤖 chip rather than widening the load bar, so the bar
    keeps meaning the same thing across teams that scored supervision and teams that didn't.
    Distinguished by glyph and border, not colour alone.

  `examples/acme-org` now also demonstrates an `alignsWith[].kind` (`learns-from` on Stream
  Checkout's tech lead) alongside an undecorated entry on Stream Onboarding, so the canonical example
  shows both the named relation and the default.

- dcbfdda: `deriveContextBundle` now returns `seams[]`: every pair of teams the matched entries span, with the
  interaction `mode` declared between them and `undeclared: true` when neither team declares any edge
  to the other.

  A bundle otherwise reads as if the goal belongs to whichever team was scoped, when in practice the
  highest-scoring entries routinely straddle a boundary — which is where the risk is. Naming the seam
  tells an assistant who else has a stake before it starts rather than after someone notices, and an
  undeclared seam deserves more caution than a declared one, not less.

  Purely additive, and derived from the `teamId` each `ScoredEntry` already carries, so it costs one
  pass and no extra lookups. `POST /context` and the `get_context_bundle` MCP tool pass it through
  unchanged.

- e676027: Add `teamapi shadow-ai <patterns...> --scan <dir>`, which reports AI adoption found in repository
  checkouts against what teams declare in `agents[]`: MCP configs, agent instruction files,
  assistant config directories, LLM SDKs in manifests, and workflow steps that call a model. Local
  and offline — it reads checkouts already on disk, with no clone, fetch or token.

  Only `forbidden` (artifacts in a repo owned by a team whose policies forbid agents) exits non-zero;
  undeclared usage warns. `scanForAiArtifacts`, `planShadowAi`, `formatShadowAi` and `repoNameFromUrl`
  are exported from core, and `agentsForbidden` is now exported from the paperclip-drift module so
  both checks share one definition of what a policy forbidding agents looks like.

- 1f2a3a4: Add `teamapi gaps`, which reports accountability holes between teams rather than inside any one of
  them: subscriptions to events nothing publishes, agents whose `ownerId` names nobody on the team,
  vacant roles other teams report into, and one-sided collaborations. `planGaps`/`formatGaps` are
  exported from core. Only `orphan-subscription` and `dangling-owner` exit non-zero, so it can gate a
  required check without ordinary findings failing a build; `teamapi gaps examples/acme-org` reports
  four warnings and exits 0.

  Ships `examples/driftwood-org`, an org that validates cleanly but is deliberately built to fail the
  new check. It is a second test fixture alongside `acme-org`, which `CONTRIBUTING.md` normally
  discourages — a broken org can't live inside the one every other example renders from without
  breaking those examples.

- fa1ff63: Add an optional `cognitiveLoad.supervision` (1-10): the load of supervising AI agents — reviewing
  what they produce, maintaining prompts, being the person everyone asks — which no role description
  covers today.

  It is deliberately **not** part of `total`, but it **is** one of the label's independent triggers,
  on the same thresholds as `extraneous` (≥4 elevated, ≥7 overloaded). Those are two separate
  decisions: the three Team Topologies types are what `total`'s thresholds are calibrated against, so
  summing a fourth term would re-scale it for every team that adopted an agent — but the label has
  never been a function of `total` alone, and a team drowning in agent review must not be able to
  report "sustainable" on the strength of three modest other scores. A team that has not scored
  `supervision` is unaffected: an absent value reads as 0.

  The value reaches `/cognitive-load`, `get_team_cognitive_load` and `GET /teams/:id` (via a new
  field on `CognitiveLoadDto`). It is kept out of `extraneous` because reviewing an agent's output is
  often the work rather than avoidable friction around it.

  `teamapi gaps` gains an `unscored-supervision` warning for teams that assess their cognitive load
  and run active agents but leave the new field blank.

- 2ec4c6c: Serve `teamapi gaps` over HTTP and MCP, and link agents to the humans accountable for them.

  - **`GET /gaps`**, the **`get_org_gaps`** MCP tool, and a matching chat tool. `gaps` is a pure
    function of the resolved graph with no token and no I/O — the same shape as `/cognitive-load` —
    so unlike the drift checks there is no reason it should be CLI-only. An assistant asking "what is
    nobody responsible for here?" can now compute the answer instead of waiting for a CI log.
  - **`accountableFor`** (member → agent) in the knowledge graph, resolved from `agents[].ownerId`.
    Emitted only when the id resolves to a declared member: a dangling `ownerId` is `gaps`'s blocking
    `dangling-owner` finding, and drawing an edge to a person who isn't there would launder exactly
    the false impression of accountability that finding exists to catch.
  - The knowledge graph's role-edge relations gain `advises`/`learnsFrom`/`communityOfPractice`,
    matching the informal `alignsWith[].kind` values.

- a7ecce1: `buildOrgHierarchyDiagram` takes an optional `{ includeAgents }`, exposed as
  `teamapi render --scope org-hierarchy --with-agents`: each team's declared `agents[]` is drawn
  hanging off the human whose `ownerId` names them, by a dotted "supervises" edge.

  Agents appear as participants but never as boxes in the chart. An agent placed in the hierarchy
  the way a person is would suggest accountability sits with it, when it never does — so an agent
  with no resolvable owner gets no incoming edge and visibly floats, which is exactly what an unowned
  agent is. Paused agents are labelled with their status rather than hidden.

  Off by default, so every existing render — including the Mermaid committed in the README — is
  byte-identical.

- 1d96a38: Let `alignsWith[]` entries name what kind of informal tie they are, via an optional
  `kind`: `aligns-with` (the default when omitted), `advises`, `learns-from` or
  `community-of-practice`. These describe the network work actually travels along — who a role takes
  advice from, who it learned a practice from, which community it belongs to — which the reporting
  hierarchy never explains.

  A discriminator on the existing `RoleRefSchema` rather than new arrays, so the whole `alignsWith`
  resolution path is reused and a document that omits `kind` resolves and renders exactly as before.
  Each kind becomes a `RoleGraphEdge` of the same name, drawn as a labelled dashed edge by
  `--scope org-hierarchy` and mapped into the knowledge graph. `kind` is rejected on `reportsToRef`,
  which is always formal reporting, rather than being silently ignored.

  `GapsReport` gains `roleTies: { formal, informal }`, and `teamapi gaps` prints how many cross-team
  role relationships the reporting lines explain when any of them aren't reporting lines.

### Patch Changes

- Updated dependencies [fa1ff63]
- Updated dependencies [1d96a38]
  - @jgalego/teamapi-schema@0.5.0

## 0.6.0

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

## 0.5.1

### Patch Changes

- ed56c2e: Stop shipping each package's own compiled test suite (`dist/__tests__/**`) in the published npm tarball — `tsc -b` was compiling `src/**/*.test.ts` alongside real source since nothing excluded it, and `"files": ["dist"]` then published the result. Cuts `@jgalego/teamapi-core`'s published file count by about 40% with no change in behavior; `pnpm test` is unaffected since Vitest runs the `.ts` sources directly rather than the built output.

  Rename a local variable in the CrewAI generator from `process` to `crewProcess` (the object's `process` field, matching CrewAI's own config shape, is unchanged) — a variable literally named `process` was tripping supply-chain scanners' "environment variable access" heuristic even though this code never touches `process.env` or any other global.

- Updated dependencies [ed56c2e]
  - @jgalego/teamapi-schema@0.4.1

## 0.5.0

### Minor Changes

- b3c64e3: Add AI-native resource domains to the Team API document schema: agents, memory, specifications, steering documents (with organization -> team -> project inheritance via the platform-team chain), prompts (with rendering), playbooks, policies, knowledge base entries, workflows, and AI session history. All fields are additive/optional, so existing documents keep parsing unchanged.

  Add a matching REST/MCP surface: `GET`/`list_*`/`get_*` for each new domain, `POST /teams/:id/prompts/:promptId/render`/`render_prompt`, and unified search extended to cover the new domains. Add context bundles (`POST /context`/`get_context_bundle`), which assemble the goal-relevant slice of specs/steering/policies/memory/knowledge base/prompts/playbooks for an AI assistant, and a knowledge graph (`GET /knowledge-graph`, traversal) linking teams, people, agents, and documents by ownership, role, and reference edges.

### Patch Changes

- Updated dependencies [b3c64e3]
  - @jgalego/teamapi-schema@0.4.0

## 0.4.0

### Minor Changes

- dbf75f6: Add `teamapi apply <patterns...> --org <github-org> [--yes]`: reconciles real GitHub teams and memberships with the resolved org graph, the way `terraform plan`/`apply` reconciles infrastructure. One GitHub team per Team API team (matched by slug === team id), members resolved via a new optional `Member.githubUsername` field. Always prints a plan first (`+ create team`, `+`/`- add`/`remove @user`, `!` for members with no `githubUsername` set) and only writes to GitHub when re-run with `--yes`. Exported from `@jgalego/teamapi-core` as `GithubClient`, `planGithubTeamsApply`, `formatApplyPlan`, and `executeGithubTeamsApply`.
- b73cbfd: Add `teamapi import github-org <org> --out <dir>`: bootstraps `teamapi.yml` documents from an existing GitHub org instead of hand-authoring every team from scratch — one `<team-id>/teamapi.yml` per GitHub team, with members enriched from GitHub user profiles (name, email, `githubUsername`) and `services[]` inferred from the team's repos. Every generated team defaults to `type: stream-aligned` with empty `roles[]`, since GitHub teams carry neither Team Topologies typing nor a role hierarchy — both are meant to be reviewed and corrected by hand. Exported from `@jgalego/teamapi-core` as `importGithubOrg`.

### Patch Changes

- Updated dependencies [dbf75f6]
  - @jgalego/teamapi-schema@0.3.0

## 0.3.0

### Minor Changes

- df017b2: Add a Backstage catalog generator: `teamapi generate backstage <patterns...> [--team <id>] --out <dir>` turns the resolved org graph into a Backstage `catalog-info.yaml` — a `Group` per team (with its members), a `User` per member, and, for any team with `services[]`, a `System` grouping them plus a `Component` per service, owned by that team's `Group`. Exported from `@jgalego/teamapi-core` as `buildBackstageCatalog`/`buildBackstageOrgCatalog`/`toBackstageYaml`.
- 1a5ce98: Add org-history diffing: `teamapi diff <patterns...> --against <ref>` resolves the same patterns against the working tree and against a git revision (a branch, tag, or commit sha), then reports teams added/removed, per-team role/member/service changes, cognitive-load deltas, and edge changes (interactions, dependencies, cross-team reporting lines). Exported from `@jgalego/teamapi-core` as `diffOrgGraphs`/`isEmptyDiff`/`formatOrgGraphDiff`, independent of git — `teamapi diff` is what supplies "the org as of a revision" as one side of the comparison via a git-show-backed loader.

## 0.2.0

### Minor Changes

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

### Patch Changes

- 82bbad4: Fix Mermaid topology/hierarchy diagrams failing to render on GitHub ("Cannot read properties of undefined (reading 'render')") when two teams had more than one interaction/dependency/platform edge between them. Parallel edges between the same node pair are now merged into a single edge with combined labels instead of being emitted as separate lines, which GitHub's Mermaid renderer can't handle.
- Updated dependencies [caebd20]
  - @jgalego/teamapi-schema@0.2.0

## 0.1.1

### Patch Changes

- e7703e1: Add a README to each published package so it renders on the npm listing page instead of showing "This package does not have a README."
- Updated dependencies [e7703e1]
  - @jgalego/teamapi-schema@0.1.1
