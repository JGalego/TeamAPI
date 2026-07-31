# @jgalego/teamapi-schema

## 0.5.0

### Minor Changes

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

## 0.4.1

### Patch Changes

- ed56c2e: Stop shipping each package's own compiled test suite (`dist/__tests__/**`) in the published npm tarball — `tsc -b` was compiling `src/**/*.test.ts` alongside real source since nothing excluded it, and `"files": ["dist"]` then published the result. Cuts `@jgalego/teamapi-core`'s published file count by about 40% with no change in behavior; `pnpm test` is unaffected since Vitest runs the `.ts` sources directly rather than the built output.

  Rename a local variable in the CrewAI generator from `process` to `crewProcess` (the object's `process` field, matching CrewAI's own config shape, is unchanged) — a variable literally named `process` was tripping supply-chain scanners' "environment variable access" heuristic even though this code never touches `process.env` or any other global.

## 0.4.0

### Minor Changes

- b3c64e3: Add AI-native resource domains to the Team API document schema: agents, memory, specifications, steering documents (with organization -> team -> project inheritance via the platform-team chain), prompts (with rendering), playbooks, policies, knowledge base entries, workflows, and AI session history. All fields are additive/optional, so existing documents keep parsing unchanged.

  Add a matching REST/MCP surface: `GET`/`list_*`/`get_*` for each new domain, `POST /teams/:id/prompts/:promptId/render`/`render_prompt`, and unified search extended to cover the new domains. Add context bundles (`POST /context`/`get_context_bundle`), which assemble the goal-relevant slice of specs/steering/policies/memory/knowledge base/prompts/playbooks for an AI assistant, and a knowledge graph (`GET /knowledge-graph`, traversal) linking teams, people, agents, and documents by ownership, role, and reference edges.

## 0.3.0

### Minor Changes

- dbf75f6: Add `teamapi apply <patterns...> --org <github-org> [--yes]`: reconciles real GitHub teams and memberships with the resolved org graph, the way `terraform plan`/`apply` reconciles infrastructure. One GitHub team per Team API team (matched by slug === team id), members resolved via a new optional `Member.githubUsername` field. Always prints a plan first (`+ create team`, `+`/`- add`/`remove @user`, `!` for members with no `githubUsername` set) and only writes to GitHub when re-run with `--yes`. Exported from `@jgalego/teamapi-core` as `GithubClient`, `planGithubTeamsApply`, `formatApplyPlan`, and `executeGithubTeamsApply`.

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

## 0.1.1

### Patch Changes

- e7703e1: Add a README to each published package so it renders on the npm listing page instead of showing "This package does not have a README."
