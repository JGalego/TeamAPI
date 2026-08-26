# @jgalego/teamapi

## 0.6.1

### Patch Changes

- Updated dependencies [b6b668f]
- Updated dependencies [6d0296a]
- Updated dependencies [15a86ad]
- Updated dependencies [7a57e8a]
- Updated dependencies [dbc711d]
- Updated dependencies [1e40e3a]
- Updated dependencies [7b88c09]
- Updated dependencies [5367863]
- Updated dependencies [f9c29ca]
- Updated dependencies [ca65ddf]
  - @jgalego/teamapi-core@0.9.0
  - @jgalego/teamapi-rest-api@0.7.0
  - @jgalego/teamapi-chat@0.3.1
  - @jgalego/teamapi-mcp-server@0.5.1

## 0.6.0

### Minor Changes

- 36e83c6: Add `teamapi topology` — the Team Topologies design smells.

  `gaps` asks what nobody owns. This asks whether the shape is right when everything _is_ owned:
  collaborations past the duration they declared for themselves or with no duration at all, teams
  past the size at which they hold shared context, teams in more concurrent collaborations than they
  can sustain, platform teams depending on the teams they exist to serve, and dependencies a team has
  itself labelled blocking.

  The collaboration checks are the point — Team Topologies is emphatic that collaboration is the
  expensive, deliberately temporary mode, and a collaboration with no end date is two teams that have
  merged without saying so. Nothing here was visible until something read the dates.

  Everything is a warning and exits 0; thresholds and per-kind severities are configurable in
  `teamapi.config.yml`. These are prompts for a conversation, not defects.

- 543da37: Add `teamapi fmt` — canonical formatting for Team API documents.

  Documents edited by hand across an org accumulate their authors' habits about where a section
  goes, so two teams adding the same thing produce diffs that look nothing alike. `fmt` orders
  top-level keys the way the schema declares them (not alphabetically — the document is meant to be
  read top to bottom), keeps unknown keys rather than dropping them, and `--check` fails a build
  without writing.

  Built on a comment-preserving document tree rather than a load/dump round trip, which would have
  deleted every comment in every file it touched. The bundled examples are now canonical and
  `pnpm fmt:check` guards them in this repo's own gate.

- d4d0372: Add severity overrides and expiring waivers for `teamapi gaps`, via a `teamapi.config.yml`.

  Run the check against an org that has existed for years and it reports the whole accumulated
  history at once — and a check that goes red on the day it's switched on gets switched back off.
  `severity` re-grades a whole kind (including `off`), waivers exempt one specific finding with a
  mandatory reason.

  Waivers expire, because an exemption that doesn't is a deletion with extra steps, and a lapsed one
  is reported as its own finding rather than silently turning a build red. Waivers matching nothing
  are reported so the file doesn't accumulate dead exemptions, and an unknown gap kind is an error —
  a typo that quietly does nothing while the org believes a rule is in force is worse than no config.

- ec29a2c: `teamapi digest` merges gaps, policy and topology findings with what moved since the last run, and posts it to a Slack/Teams webhook, an HTML file for email, or stdout. State is a JSON file rather than a database, so a scheduled run can keep it in a workflow cache. `.github/workflows/digest.yml` runs it weekly, opt-in.
- 41f5fe3: Fail validation on org-wide name conflicts.

  The schema enforces uniqueness within a document, because that is all one document can see. Names
  that have to be unique across the whole org — service names, channels — were never checked, so two
  teams could both declare `payments-api` and `findServiceOwner` would answer with whichever team id
  sorted first. Silently, and for every consumer downstream of it: the REST route, the MCP tool, the
  Slack command, generated CODEOWNERS.

  `teamapi validate` now reports both claimants and exits non-zero. The tie-break stays — a query
  has to return something — but the org no longer has to discover it by noticing that a service it
  owns answers with someone else's team.

  **Breaking for orgs that currently have duplicates**: validation that passed before will now fail
  until the duplicate name is resolved.

- f41844d: Add the schema migration mechanism, and version-aware diagnostics.

  There is one `teamApiVersion`, so there is nothing to migrate yet — which is when the mechanism
  has to exist. A format with one version and no migration path has a migration problem scheduled
  for the day the second version ships, by which point documents are spread across every repository
  in an org.

  `MIGRATIONS` is an ordered chain a document walks toward `LATEST_TEAM_API_VERSION`, run by
  `teamapi migrate`. It ships empty on purpose: a placeholder migration would be one real documents
  could hit, so the runner is tested against fixtures instead.

  The half that helps today is diagnosis. A version mismatch used to fail as `teamApiVersion:
Invalid literal value, expected "1.0.0"`, which reads identically whether documents are behind the
  toolchain or ahead of it — opposite problems needing opposite fixes. `assessVersion` tells them
  apart, and both `migrate` and `validate` now say which one you have.

- 6152e09: Keep the long-running servers current with `--watch`.

  `OrgGraphStore.reload()` existed and nothing ever called it, so both servers answered from a
  startup snapshot for as long as they ran — worst for `serve-mcp`, where an assistant holds the
  connection open for a whole session.

  `--watch` re-resolves on change, `POST /reload` (or `--reload-endpoint` on its own) covers
  webhook-driven refreshes, and `SIGHUP` covers process supervisors. Seed discovery re-runs on every
  reload, so documents _added_ after startup are picked up too.

  A failed reload never replaces a working graph: the store publishes only on success, so a document
  caught mid-write is reported and skipped while the server keeps answering from the last good state.

- a276764: Publish the JSON Schema so editors can validate `teamapi.yml` as you type.

  The schema was already derived from the Zod definitions but had no way out of the codebase. It
  now has a canonical home at `https://teamapi.dev/schema/v1.json`, a `teamapi schema` command that
  prints or writes it, and a `# yaml-language-server: $schema=` modeline on every scaffolded and
  bundled document. A test regenerates the published copy and fails when it has drifted, so the
  hosted URL can never fall behind the code.

- 01b480b: Let `teamapi.config.yml` supply seed patterns and per-command defaults.

  The config file introduced for gap waivers now also carries `patterns:` — so the commands run
  dozens of times a day lose their argument entirely — and a `defaults:` section for the flags that
  are constant for an org: its GitHub login, Okta URL, Paperclip company, serve host/port/CORS/rate
  limit. `--org` and `--url` are no longer required flags when the config supplies them.

  Precedence is CLI, then config, then built-in default, and command-line patterns replace rather
  than merge with the configured ones.

  There is deliberately no `token:` key anywhere in the schema — the file lives in the repository,
  tokens come from the environment, and the schema rejects the key rather than ignoring it.

- 9f25986: `teamapi serve-api --metrics` mounts `GET /metrics` in the Prometheus exposition format: teams by type, cognitive and supervision load per team, agents by status, gaps/policy/topology findings, unresolved references, graph age, and the server's own request counts and latencies. `collectOrgMetrics`/`renderPrometheus` are exported from core for other exporters to reuse.
- 23c56b3: Four more `teamapi import` sources beyond `github-org`: `backstage` (a catalog file or the catalog API), `okta` (directory groups, also usable for Entra via `importDirectoryGroups`), `slack` (channels as team skeletons) and `csv` (an HRIS export — the only source that can populate `roles[]`).
- 81e6c7b: Chat is no longer hardwired to one vendor. `ChatTool` is a provider-neutral tool definition, `createChatSession` picks an adapter, and `--provider openai --base-url ...` reaches any OpenAI-compatible server (Azure, Ollama, vLLM, Together, Groq, OpenRouter, …) with no vendor SDK. `teamapi chat --ask "<question>"` runs one turn, prints the answer on stdout with everything else on stderr, and exits 2 if the answer is incomplete.
- 7bfb3d1: Add `--format json` and `--format sarif` to the reporting commands.

  `validate`, `gaps`, `policy` and `shadow-ai` now take `--format text | json | sarif`, and `diff`
  takes `--format text | json`. Everything printed human-readable text before, so a CI job could
  gate on an exit code but never say _what_ was wrong on the diff that caused it.

  The SARIF output is the point: uploaded with `github/codeql-action/upload-sarif` (the bundled
  action gains a `sarif-dir` input that writes it), every finding becomes an inline annotation on
  the pull request and an entry in the security tab. Paths are emitted relative to the working
  directory, since consumers resolve them against the repository root.

  `json` emits the report object the library returns rather than a re-rendering of the text, and the
  unresolved-reference warning is suppressed for structured formats so the output stays parseable.
  Exit codes are unchanged by the format.

- 9c804ee: Add `teamapi init` — scaffold a whole org repository, not one document.

  `scaffold` produced a single team and left open every decision that actually stands between
  trying this and using it: where documents live, how CI runs them, how an editor validates them.
  `init` makes those decisions, consistently with what every command already defaults to.

  It writes `teamapi.config.yml` (so every command works with no arguments), a CI workflow wired to
  the bundled action, VS Code settings binding the documents to the published schema, a README, and
  a first stream-aligned and platform team.

  The workflow's gating checks ship commented out: a new org has no gaps, and a check that turned
  red on the day its documents first described a real one is a check that gets deleted. It refuses
  to overwrite by default, naming every file it would have replaced rather than stopping at the
  first.

- eca4cde: Check declared `policies[]` against the org graph with `teamapi policy`.

  Policies were declared but never evaluated — the schema said "external automation enforces this"
  and nothing verified that any such automation existed. The new engine decides every rule it can
  from the graph alone (agent bans and caps, owner requirements, provider allow-lists, cognitive
  load ceilings, required steering/playbook categories, service repository and bounded-context
  requirements, dependency caps), reports rules it can't as `delegated` when `enforcedBy` names an
  enforcer, and — the point of the exercise — reports them as `unenforced` when nothing does.

  A blocking policy that nothing enforces now exits non-zero, as does a violated one. Available in
  CI via `check-policies: true` on the bundled action.

- b6b5a86: `teamapi history` resolves the org at a series of past git revisions and reports the trend: cognitive load, agent adoption, supervision creep, vacancies, blocking gaps and team churn, sampled per commit/day/week/month/quarter, as a table, JSON or CSV. `GitRefLoaderRegistry` and `gitRepoRoot` move into core, where `diff` and `history` now share them.
- 6d7b1e9: `teamapi serve-api --propose-to owner/repo` mounts `POST /teams/:id/proposals`: a small, closed patch to one team becomes a pull request against the repository the documents came from, re-validated and re-formatted first. The dashboard's team panel grows an edit form when the server reports the capability. `GET /health` now reports which optional surfaces are mounted.
- 0d6d857: Resolve a whole BFS level at once instead of one document at a time, and cache `https://` refs on disk between runs. `buildOrgGraph` takes `concurrency` and `cache`; the CLI reads `TEAMAPI_CACHE_DIR`, `TEAMAPI_NO_CACHE` and `TEAMAPI_RESOLVE_CONCURRENCY`. `generateSyntheticOrg` builds an org of arbitrary size for benchmarking.
- 54f0325: Embedding-backed search. `semanticSearchOrg` unions substring matching with cosine similarity; `createEmbeddingScorer` layers the same signal onto `deriveContextBundle` without making it async. `teamapi serve-api --embeddings` enables `GET /search?mode=hybrid|semantic` and `POST /context {semantic:true}`, against any OpenAI-compatible `/embeddings` endpoint, with vectors cached on disk.
- 5da3465: Make the REST API safe to expose: bearer auth, CORS and rate limiting.

  `serve-api` had no authentication, no CORS control and no rate limiting, which meant the only
  correct place to run it was localhost — and nothing stopped anyone from binding `0.0.0.0` anyway.

  Auth is opt-in (`--token`, or `TEAMAPI_API_TOKEN`) so the local workflow is unchanged, and binding
  a non-loopback address without one is now refused outright rather than warned about, since an
  exposed server looks exactly like a working one. `--allow-anonymous` is the deliberate escape
  hatch. `/health` stays open for liveness probes and `/slack/*` keeps its own request signature.

  Token comparison is constant-time, rejections never echo the presented credential, and the auth
  hook runs at `preParsing` so the rate limiter counts failed attempts — at `onRequest` it could
  not, leaving token guessing effectively unlimited.

- a932887: Serve MCP over Streamable HTTP with `serve-api --mcp`.

  MCP was stdio-only, which requires the documents on the same machine as the model — so every
  laptop held its own copy of the org graph, each as current as the last time somebody pulled. The
  same tools are now served at `POST /mcp` on the REST API's port, behind the same bearer token,
  alongside `--watch` so one endpoint answers with the org as of the last commit.

  Stateless: a fresh server and transport per request, no session id issued or required. Every tool
  is a pure read of the graph, so there is no per-client state worth keeping, and any instance
  behind a load balancer can answer any request.

  The handler is injected into `buildServer`, so the REST API package keeps no MCP dependency.

- a713d92: `teamapi apply-to <slack|okta|pagerduty>` reconciles membership in those systems with the org graph, behind the same plan-then-`--yes` shape as `apply`. Slack usergroups (created if missing), Okta group membership, and PagerDuty team membership. Schedules, escalation policies, directory groups and PagerDuty teams are never written — see each planner for why.

### Patch Changes

- 5bc5ee7: Add a scheduled drift-watch action that keeps a single tracking issue in sync with the org-graph
  checks.

  Pull-request checks only fire when somebody edits a `teamapi.yml`, but most drift is the reverse:
  the documents sit still while the org moves around them. `.github/actions/drift` runs `validate`,
  `gaps`, and optionally `policy` and `shadow-ai` on a schedule, then opens, updates, or closes one
  tracking issue — found by a marker in its body so it survives renaming, and never opened merely to
  report that nothing is wrong.

- Updated dependencies [36e83c6]
- Updated dependencies [817a21f]
- Updated dependencies [8abf5c8]
- Updated dependencies [543da37]
- Updated dependencies [d4d0372]
- Updated dependencies [b047116]
- Updated dependencies [ec29a2c]
- Updated dependencies [41f5fe3]
- Updated dependencies [f41844d]
- Updated dependencies [6152e09]
- Updated dependencies [a276764]
- Updated dependencies [9f25986]
- Updated dependencies [23c56b3]
- Updated dependencies [81e6c7b]
- Updated dependencies [7bfb3d1]
- Updated dependencies [eca4cde]
- Updated dependencies [b6b5a86]
- Updated dependencies [6d7b1e9]
- Updated dependencies [0d6d857]
- Updated dependencies [54f0325]
- Updated dependencies [5da3465]
- Updated dependencies [a98a31e]
- Updated dependencies [a932887]
- Updated dependencies [a713d92]
  - @jgalego/teamapi-core@0.8.0
  - @jgalego/teamapi-rest-api@0.6.0
  - @jgalego/teamapi-schema@0.6.0
  - @jgalego/teamapi-chat@0.3.0
  - @jgalego/teamapi-mcp-server@0.5.0

## 0.5.0

### Minor Changes

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

- a7ecce1: `buildOrgHierarchyDiagram` takes an optional `{ includeAgents }`, exposed as
  `teamapi render --scope org-hierarchy --with-agents`: each team's declared `agents[]` is drawn
  hanging off the human whose `ownerId` names them, by a dotted "supervises" edge.

  Agents appear as participants but never as boxes in the chart. An agent placed in the hierarchy
  the way a person is would suggest accountability sits with it, when it never does — so an agent
  with no resolvable owner gets no incoming edge and visibly floats, which is exactly what an unowned
  agent is. Paused agents are labelled with their status rather than hidden.

  Off by default, so every existing render — including the Mermaid committed in the README — is
  byte-identical.

### Patch Changes

- Updated dependencies [7ca7e0c]
- Updated dependencies [dcbfdda]
- Updated dependencies [fefe0b2]
- Updated dependencies [e676027]
- Updated dependencies [1f2a3a4]
- Updated dependencies [fa1ff63]
- Updated dependencies [2ec4c6c]
- Updated dependencies [a7ecce1]
- Updated dependencies [1d96a38]
  - @jgalego/teamapi-core@0.7.0
  - @jgalego/teamapi-rest-api@0.5.0
  - @jgalego/teamapi-chat@0.2.0
  - @jgalego/teamapi-schema@0.5.0
  - @jgalego/teamapi-mcp-server@0.4.0

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
