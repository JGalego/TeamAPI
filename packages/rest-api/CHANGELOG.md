# @jgalego/teamapi-rest-api

## 0.6.0

### Minor Changes

- 817a21f: Every collection route accepts `limit`/`offset` and answers with `X-Total-Count` and an RFC 8288 `Link` header; every `GET` carries a content-derived `ETag` and honours `If-None-Match`. Both are additive — an existing client that passes neither sees exactly what it saw before.
- 8abf5c8: `GET /backstage/catalog` serves the org as Backstage entities — the same generator `teamapi generate backstage` writes, served rather than written. The new `@jgalego/teamapi-backstage` package is a catalog entity provider that polls it, with no `@backstage/*` dependency.
- b047116: The dashboard covers the AI-native half of the API it had been ignoring: an agent roster with unowned agents marked, AI session history, the context map's conflicts alongside the diagram, and a walkable knowledge graph. `/health` reports which optional surfaces the server has.
- 6152e09: Keep the long-running servers current with `--watch`.

  `OrgGraphStore.reload()` existed and nothing ever called it, so both servers answered from a
  startup snapshot for as long as they ran — worst for `serve-mcp`, where an assistant holds the
  connection open for a whole session.

  `--watch` re-resolves on change, `POST /reload` (or `--reload-endpoint` on its own) covers
  webhook-driven refreshes, and `SIGHUP` covers process supervisors. Seed discovery re-runs on every
  reload, so documents _added_ after startup are picked up too.

  A failed reload never replaces a working graph: the store publishes only on success, so a document
  caught mid-write is reported and skipped while the server keeps answering from the last good state.

- 9f25986: `teamapi serve-api --metrics` mounts `GET /metrics` in the Prometheus exposition format: teams by type, cognitive and supervision load per team, agents by status, gaps/policy/topology findings, unresolved references, graph age, and the server's own request counts and latencies. `collectOrgMetrics`/`renderPrometheus` are exported from core for other exporters to reuse.
- 6d7b1e9: `teamapi serve-api --propose-to owner/repo` mounts `POST /teams/:id/proposals`: a small, closed patch to one team becomes a pull request against the repository the documents came from, re-validated and re-formatted first. The dashboard's team panel grows an edit form when the server reports the capability. `GET /health` now reports which optional surfaces are mounted.
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

- a98a31e: Serve policy and topology over HTTP, and show all three checks in the dashboard.

  `/gaps` was already served on the argument that a check needing no credentials should be
  answerable without anyone running a report; `policy` and `topology` are the same shape and were
  unreachable only because they were written after the routes were. Both are now `GET /policy` and
  `GET /topology`.

  The dashboard gains a Health section running all three at once — counts plus one finding list
  sorted most-serious-first — and a team detail panel behind each card: roles with vacancies marked,
  members, services, agents and their owners, interactions and dependencies. Each check is fetched
  independently, so an older server missing the new routes degrades to "unavailable" rather than a
  blank section.

- a932887: Serve MCP over Streamable HTTP with `serve-api --mcp`.

  MCP was stdio-only, which requires the documents on the same machine as the model — so every
  laptop held its own copy of the org graph, each as current as the last time somebody pulled. The
  same tools are now served at `POST /mcp` on the REST API's port, behind the same bearer token,
  alongside `--watch` so one endpoint answers with the org as of the last commit.

  Stateless: a fresh server and transport per request, no session id issued or required. Every tool
  is a pure read of the graph, so there is no per-client state worth keeping, and any instance
  behind a load balancer can answer any request.

  The handler is injected into `buildServer`, so the REST API package keeps no MCP dependency.

### Patch Changes

- Updated dependencies [36e83c6]
- Updated dependencies [543da37]
- Updated dependencies [d4d0372]
- Updated dependencies [ec29a2c]
- Updated dependencies [41f5fe3]
- Updated dependencies [f41844d]
- Updated dependencies [6152e09]
- Updated dependencies [a276764]
- Updated dependencies [9f25986]
- Updated dependencies [23c56b3]
- Updated dependencies [7bfb3d1]
- Updated dependencies [eca4cde]
- Updated dependencies [b6b5a86]
- Updated dependencies [6d7b1e9]
- Updated dependencies [0d6d857]
- Updated dependencies [54f0325]
- Updated dependencies [a713d92]
  - @jgalego/teamapi-core@0.8.0
  - @jgalego/teamapi-schema@0.6.0

## 0.5.0

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

### Patch Changes

- Updated dependencies [7ca7e0c]
- Updated dependencies [dcbfdda]
- Updated dependencies [e676027]
- Updated dependencies [1f2a3a4]
- Updated dependencies [fa1ff63]
- Updated dependencies [2ec4c6c]
- Updated dependencies [a7ecce1]
- Updated dependencies [1d96a38]
  - @jgalego/teamapi-core@0.7.0
  - @jgalego/teamapi-schema@0.5.0

## 0.4.0

### Minor Changes

- e96acc8: Add a Slack integration: a `/whoowns` slash-command endpoint on the REST API,
  mounted only when `SLACK_SIGNING_SECRET` is set and verifying Slack's request
  signature in constant time with a five-minute replay window; and a `slack-sync`
  command that sets each declared channel's topic to name the owning team, with the
  same plan/apply split as `teamapi apply`.

### Patch Changes

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

## 0.3.1

### Patch Changes

- ed56c2e: Stop shipping each package's own compiled test suite (`dist/__tests__/**`) in the published npm tarball — `tsc -b` was compiling `src/**/*.test.ts` alongside real source since nothing excluded it, and `"files": ["dist"]` then published the result. Cuts `@jgalego/teamapi-core`'s published file count by about 40% with no change in behavior; `pnpm test` is unaffected since Vitest runs the `.ts` sources directly rather than the built output.

  Rename a local variable in the CrewAI generator from `process` to `crewProcess` (the object's `process` field, matching CrewAI's own config shape, is unchanged) — a variable literally named `process` was tripping supply-chain scanners' "environment variable access" heuristic even though this code never touches `process.env` or any other global.

- Updated dependencies [ed56c2e]
  - @jgalego/teamapi-schema@0.4.1
  - @jgalego/teamapi-core@0.5.1

## 0.3.0

### Minor Changes

- b3c64e3: Add AI-native resource domains to the Team API document schema: agents, memory, specifications, steering documents (with organization -> team -> project inheritance via the platform-team chain), prompts (with rendering), playbooks, policies, knowledge base entries, workflows, and AI session history. All fields are additive/optional, so existing documents keep parsing unchanged.

  Add a matching REST/MCP surface: `GET`/`list_*`/`get_*` for each new domain, `POST /teams/:id/prompts/:promptId/render`/`render_prompt`, and unified search extended to cover the new domains. Add context bundles (`POST /context`/`get_context_bundle`), which assemble the goal-relevant slice of specs/steering/policies/memory/knowledge base/prompts/playbooks for an AI assistant, and a knowledge graph (`GET /knowledge-graph`, traversal) linking teams, people, agents, and documents by ownership, role, and reference edges.

### Patch Changes

- Updated dependencies [b3c64e3]
  - @jgalego/teamapi-schema@0.4.0
  - @jgalego/teamapi-core@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies [dbf75f6]
- Updated dependencies [b73cbfd]
  - @jgalego/teamapi-schema@0.3.0
  - @jgalego/teamapi-core@0.4.0

## 0.2.0

### Minor Changes

- 5056af1: Add a live browser dashboard at `GET /dashboard`: a self-contained static page (no separate process, no build step) that fetches the same REST API it's served from — a team list with type/focus, a cognitive-load bar per team (color- and icon-coded, never color alone), free-text search, and a tabbed diagram viewer (topology / org-hierarchy / context-map) rendered client-side with Mermaid loaded from a CDN. Each section loads and fails independently, so a blocked CDN only disables the diagram tab.

### Patch Changes

- Updated dependencies [df017b2]
- Updated dependencies [1a5ce98]
  - @jgalego/teamapi-core@0.3.0

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

## 0.1.1

### Patch Changes

- e7703e1: Add a README to each published package so it renders on the npm listing page instead of showing "This package does not have a README."
- Updated dependencies [e7703e1]
  - @jgalego/teamapi-core@0.1.1
  - @jgalego/teamapi-schema@0.1.1
