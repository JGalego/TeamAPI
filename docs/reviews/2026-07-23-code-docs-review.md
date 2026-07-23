# TeamAPI — Full Code + Docs Review (2026-07-23)

Scope: every package (`schema`, `core`, `cli`, `rest-api`, `mcp-server`, `chat`), the spec
(`docs/spec/teamapi-extended-v1.md`), the bundled example org (`examples/acme-org`), and
repo-level tooling (CI, changesets, packaging). Root `README.md`'s every code example, diagram,
and JSON sample was cross-checked field-by-field against the actual example data and code.

**Headline result:** the root README's examples are excellent — every diagram, JSON sample, and
transcript in it was verified byte-for-byte accurate against `examples/acme-org` and the current
code. The gaps are concentrated in three places: (1) the **spec document** has drifted from what
the resolver actually does and has several broken internal links; (2) a handful of **validation
gaps** let malformed org data (dangling `reportsTo`, duplicate ids, both `reportsTo`+`reportsToRef`
set) pass silently instead of erroring; (3) **tool/schema logic is triplicated** across
`mcp-server`, `chat`, and `rest-api` with no shared source of truth, and it has already started to
drift.

---

## 1. Fix now (high severity)

### 1.1 Same-team `reportsTo` is never validated against real role ids
**Files:** `packages/core/src/diagrams/hierarchy.ts:23`, `packages/core/src/diagrams/org-hierarchy.ts:38-47`, `packages/schema/src/v1/roles.ts:49-53`

Cross-team references (`reportsToRef`, `alignsWith`) are validated by `graph-builder.ts` via
`roleExists` and surface as `unresolved` entries when broken. The same-team case
(`role.reportsTo: <role-id>`) is validated **nowhere** — not in the Zod schema (no sibling-role
uniqueness/existence check is possible without a `superRefine` over the whole `roles[]` array) and
not in core. A typo (`reportsTo: tech-laed`) parses fine, produces no `unresolved` entry, and
silently renders a phantom, unlabeled node in the hierarchy/org-hierarchy diagrams — the intended
reporting line is dropped with zero diagnostics anywhere in the pipeline.

**Fix:** add a `superRefine` on `RolesSchema` (`packages/schema/src/v1/roles.ts`) that checks every
`reportsTo` value against the sibling `roles[].id` set, and reject a role that sets **both**
`reportsTo` and `reportsToRef` (the spec already documents these as "mutually exclusive in
practice" — enforce it). Also add a self-report/same-team cycle check (A→B→A).

### 1.2 Duplicate `roles[].id` / `members[].id` is unenforced
**Files:** `packages/schema/src/v1/roles.ts:61,75`

The spec (`docs/spec/teamapi-extended-v1.md:66,104`) requires role/member ids to be unique within
a team, but `RolesSchema`/`MembersSchema` are plain `z.array(...)` with no uniqueness check. Two
roles sharing an id parse successfully and then corrupt every id-indexed consumer downstream
(`hierarchy.ts:24-27`, `generators/crewai.ts:106-111`).

**Fix:** `.superRefine` for duplicate `id` values in both arrays, matching the existing
duplicate-team-id check pattern already used in `graph-builder.ts`.

### 1.3 `--scope` / `--format` on `teamapi render` accept any string and silently fall back
**File:** `packages/cli/src/commands/render.ts:30-34`, `packages/cli/src/main.ts:26-27`

Both flags are free-text options with no `.choices()` constraint. `--scope toplogy` (typo) or
`--format json` silently falls through an if/else chain to the default branch (full topology
diagram / Mermaid) and exits 0 — no error, no warning. Commander (already a dependency) supports
`.choices([...])` for exactly this.

**Fix:** `.choices(["topology","hierarchy","context-map","org-hierarchy"])` and
`.choices(["mermaid","dot"])` on the respective options in `main.ts`.

### 1.4 `teamapi scaffold` misattributes user-input errors to "a bug in the template"
**File:** `packages/cli/src/commands/scaffold.ts:31-36`

An invalid `<id>` (not kebab-case) or invalid `--type` fails `TeamApiDocumentSchema.safeParse`, but
the printed message is `"Scaffolded document failed validation — this is a bug in the scaffold
template."`, followed by the raw, unformatted `ZodError.message` — even though the existing,
friendlier `formatZodError` helper (`packages/core/src/validate/format-errors.ts`) is already used
elsewhere in the codebase for exactly this kind of output.

**Fix:** reuse `formatZodError`; reword the message to point at the actual bad input (`<id>` /
`--type`), not an implied internal bug.

### 1.5 `get_org_graph` (MCP) and `GET /graph` (REST) both silently omit `roleEdges`
**Files:** `packages/mcp-server/src/tools/register.ts:197-214`, `packages/rest-api/src/routes/graph.ts:16-21`, root cause in `packages/core/src/model/org-graph.ts:33-47`

Both are documented/described as returning "the full resolved org graph" / "all edges," but neither
includes `graph.roleEdges` — the `reports-to`/`aligns-with` cross-team role edges that power the
org-hierarchy diagram. There is currently **no JSON endpoint anywhere** that exposes this data
structurally; it's only reachable as rendered Mermaid/DOT text. An LLM asked "which roles report
cross-team?" via `get_org_graph` gets an incomplete answer despite the tool's own "all edges"
claim.

**Fix:** add `roleEdges` to both DTOs (a single shared serializer function in `packages/core`
would fix both call sites at once — see §4 below on de-duplication).

### 1.6 The spec document's own `$ref`-resolution list is wrong
**File:** `docs/spec/teamapi-extended-v1.md:21-24` vs. `packages/core/src/resolve/graph-builder.ts:125-131`

The spec states `$ref` is resolved only in `platform`, `interactions[]`, and `dependencies[]`, and
explicitly says `work.*[].$ref` is *not* traversed — but never mentions `roles[].reportsToRef.$ref`
or `roles[].alignsWith[].$ref` at all, both of which **are** traversed by the resolver (confirmed
in code) and are exactly what makes the README's org-wide role-hierarchy diagram possible. The
spec's own enumeration of what gets resolved is incomplete and misleading.

**Fix:** rewrite that paragraph to explicitly list all five resolved locations
(`platform`, `interactions[].$ref`, `dependencies[].$ref`, `roles[].reportsToRef.$ref`,
`roles[].alignsWith[].$ref`) and confirm `work.*` remains intentionally unresolved.

### 1.7 Five of eleven links in the spec's root-object table point at non-existent anchors
**File:** `docs/spec/teamapi-extended-v1.md:36-46`

`#channel`, `#searchterm`, `#ref`, `#work`, `#meeting` don't exist as headings anywhere in the
document; `#service`/`#interaction`/`#dependency` mismatch the real (differently-worded or
pluralized) heading slugs. Net effect: **`channels`, `searchTerms`, `platform`, `work`, and
`meetings`** — all five of which are used in the bundled ACME examples — have **zero documented
field-level shape** in the spec.

**Fix:** add the missing `## Channel`, `## SearchTerm`, `## Ref`, `## Work`, `## Meeting`
sections (field tables, matching the style already used for `Team`/`Role`/`Service`), and fix the
mismatched anchor text on the other three.

### 1.8 `chat` package pins a different major of `zod` than every sibling package
**File:** `packages/chat/package.json:30` (`zod: "^4.0.0"`) vs. `core`/`mcp-server`/`schema` (`^3.23.8`)

`packages/chat/src/tools.ts` re-declares the same tool schemas as `mcp-server` but under Zod v4,
fed through `betaZodTool` from `@anthropic-ai/sdk`. Zod v4 changed internal schema representation;
an SDK helper written against v3 conventions may silently mis-convert a v4 schema into an
incomplete/wrong `input_schema` sent to the model — a correctness risk with no test that would
catch it, plus it forces two zod majors to coexist in `node_modules`.

**Fix:** pin `zod: "^3.23.8"` in `packages/chat` to match every other package, and confirm
`@anthropic-ai/sdk`'s zod helper is tested against that version.

### 1.9 `packages/cli/src/commands/chat.ts` has zero test coverage
**File:** `packages/cli/src/__tests__/` (no `chat` references at all)

This is the actual command a user runs (`teamapi chat`), and it's where the largest share of
findings in this report live (missing `stop_reason` check, no turn cap, debug-only tool
visibility, the `--debug` formatting helpers). None of it is under test.

**Fix:** at minimum, unit-test `runChat`'s option validation (unknown team/member), the
missing-`ANTHROPIC_API_KEY` early exit, and the `--debug` formatting helpers
(`prettyToolOutput`, `indentContinuationLines`) in isolation from the network call.

---

## 2. Medium-severity findings, by package

### `packages/schema`
- **No `.passthrough()` on `RefSchema`/`RoleRefSchema`** (`primitives.ts:10-12`, `roles.ts:7-10`) — breaks the spec's blanket claim that "every object allows unknown `x-*` vendor fields," unlike the structurally identical `InteractionSchema`/`DependencySchema` which do call `.passthrough()`. Any `x-*` field on a `platform:`, `reportsToRef:`, or `alignsWith[]` entry is silently stripped.
- **`SUGGESTED_ROLE_KINDS`, `isSupportedVersion`, `resolveSchemaForVersion`** (`packages/schema/src/index.ts:9-22`) have zero test coverage and zero consumers anywhere in the monorepo — dead, untested exports (versioning forward-compat seam, currently unused since only `1.0.0` exists).
- Root README's `find_service_owner` field-order in the JSON example was verified **correct**, including why `versioning` appears before `repository` (zod parse output follows shape-declaration order, not YAML source order) — noted here as a **non-issue**, since it's the kind of thing that looks like a bug at first glance.

### `packages/core`
- **`detectConflicts` only compares interaction `mode`, never `contextMappingPattern`** (`context-map/derive.ts:62`) — two teams can declare genuinely conflicting DDD patterns (`SharedKernel` vs. `Conformist`) under the same `mode` and no conflict is surfaced, undercutting the function's own doc comment.
- **A duplicate team id's own outbound refs are never traversed** (`resolve/graph-builder.ts:76-84`) — if the *shadowed* copy of a duplicate id was the only file referencing some other team, that other team silently vanishes from the graph with no specific diagnostic beyond the generic "duplicate id" entry.
- **`findServiceOwner` assumes globally-unique service names** (`model/queries.ts:73`) — two teams can declare identically-named services; the function returns whichever was inserted first (an accident of Map iteration order), with no duplicate detection (unlike the explicit duplicate-team-id check elsewhere in the codebase).
- **Cognitive-load thresholds ignore composition** (`cognitive-load/score.ts:21`) — `total ≥ 18/24` fires identically for `(intrinsic=10, germane=10, extraneous=1)` and `(intrinsic=1, germane=1, extraneous=16)`, conflating a benign profile with a genuinely bad one, despite the doc's own framing that extraneous load should be weighted worse.
- **`getInteractions` defaults to `"both"`, `getDependencies` defaults to `"out"`** (`model/queries.ts:30,40`) — undocumented, easy-to-miss asymmetry between two near-identical function signatures.
- **Mermaid renderer collapses "dashed" and "dotted" edge styles to the same arrow token** (`diagrams/mermaid.ts:13-16`), while the DOT renderer correctly distinguishes them — a visual regression specific to one output format.
- **`packages/core/README.md`** documents 3 of ~20+ public exports (cognitive-load scoring, context mapping, org-hierarchy diagrams, the CrewAI generator, and the entire `model/queries.ts` surface are all undocumented).

### `packages/cli`
- **`--team` validation is inconsistent per `--scope`**: throws for `hierarchy`, silently produces an *empty* diagram for `topology`/`context-map` on an unknown id, and is silently ignored entirely for `org-hierarchy` (which doesn't accept team scoping at all) — none of this per-scope difference is documented.
- **Only `validate` inspects `graph.unresolved`**; `render`/`generate`/`serve-api`/`serve-mcp`/`chat` all build the graph with `allowPartial: true` and never check for partial-failure state, so a broken `$ref` or invalid team is silently dropped and the command proceeds as if everything were fine.
- **`--port` has no validation** (`main.ts:70-73`, `serve-api.ts:19-20`) — `NaN`/negative/out-of-range values are only ever rejected deep inside Node/Fastify internals with a raw, unfriendly message.
- **Hardcoded `--version` "0.1.0"** (`main.ts:12`) has drifted from the actual published `0.1.1`.
- Zero tests exercise the actual Commander wiring in `main.ts` — every CLI test calls the `run*` functions directly with a hand-built options object, so none of the above (enum validation, port parsing, version string) is visible to CI.
- No `engines` field in the **published** `packages/cli/package.json`, despite the root repo requiring Node ≥22 — a user on an unsupported Node version gets no npm-level warning for the actual installed artifact.

### `packages/rest-api`
- **CORS/auth/rate-limiting**: none configured, and neither README mentions this as an operational caveat (though the CLI does correctly bind to `127.0.0.1`, not `0.0.0.0`, by default — a good safe default).
- **`/graph`'s `meta.sourceRoots` and `unresolved[].fromUri`/`.reason` leak server filesystem paths** — low severity in isolation (read-only localhost dev tool) but worth a documented caveat given `buildServer` is also offered for embedding with an arbitrary `host`.
- **`/search`'s own "missing `q`" check is dead code** for the fully-absent case (Fastify's AJV schema validation already 400s first) and only reachable for `q=` (present-but-empty) — two different error bodies for what a user would consider the same mistake.
- **Stale hardcoded OpenAPI `info.version: "0.1.0"`** (`server.ts:41`) vs. actual package version `0.1.1`.
- **No response schemas for error paths** — every route's `400`/`404` behavior is real but absent from the generated OpenAPI spec at `/docs/json`.
- **Test coverage gaps**: `/teams/:id/dependencies`, `/teams/:id/roles`, `/services` list, `/diagrams/hierarchy/:teamId`, `/cognitive-load/:teamId`, `format=dot` branches, and `/docs`/`/docs/json` themselves all have **zero tests**.

### `packages/mcp-server`
- **No `get_team_dependencies` tool** — `get_team_interactions` exists but there's no equivalent for the `Slowing`/`Blocking`/`OK` dependency edges that REST exposes via `/teams/:id/dependencies`; an assistant asked "what's blocking Stream Checkout?" has no direct tool for it.
- **`find_service_owner` requires an exact match while `list_services`/`search_org` use substring matching**, and no tool description discloses this — a plausible wrong-tool-choice failure (`find_service_owner({serviceName:"checkout"})` fails even though `checkout-api` exists).
- **7 of 12 tools are never actually invoked in tests** (only checked by name in a registered-tools list); `get_org_cognitive_load_report` isn't even in that name list, suggesting the test predates the tool.
- **Team-type enum duplicated by hand** in both `mcp-server` and `rest-api` instead of imported from `@jgalego/teamapi-schema` — a new team type added to the canonical schema requires manually updating both copies or the MCP/REST filters silently reject valid data.
- Stale hardcoded server version string (`server.ts:6`, `"0.1.0"` vs. actual `0.1.1`).
- No `.min(1)` on free-text search inputs — an empty-string `search`/`query` silently matches everything instead of erroring.

### `packages/chat`
- **No `stop_reason` check before reading the final message** (`packages/cli/src/commands/chat.ts:135-141`) — a `refusal`/`max_tokens` response returns HTTP 200 and is not caught, silently producing an empty or truncated reply with no indication anything went wrong.
- **No turn/iteration cap on the tool-use loop**, and `onToolCall` is wired only under `--debug` — in default mode, a model stuck in a call-observe-call cycle just looks like the CLI hanging, with no visibility or cost guard.
- **Tool schemas/dispatch fully duplicated** between `chat` and `mcp-server` (see §4) — already drifted: `chat`'s tools signal failure via a plain string prefix (`"Error: ..."`), while `mcp-server`'s `errorResult()` sets a structured `isError: true`, a weaker and inconsistent failure signal on the chat side.
- README's `--debug` transcript shows a YAML folded-scalar `notes` field hand-wrapped across three lines; the actual `indentContinuationLines` logic only re-indents at literal `\n` boundaries and never word-wraps, so real output for that field would be one long unwrapped line — a cosmetic transcript inaccuracy, not a functional bug.
- System-prompt construction interpolates org YAML fields directly with no sanitization — a latent prompt-injection surface if `teamapi.yml` is ever sourced from less-trusted contributors (low risk for the intended internal-org use case, worth flagging for the CONTRIBUTING/security docs when they exist).

---

## 3. Docs/spec/tooling findings

- **CI runs only `build` and `test`** (`.github/workflows/ci.yml:39-43`) — never `lint` or `typecheck`, despite both existing as top-level scripts and turbo tasks. Compounding this: **there is no ESLint/Prettier config or dependency anywhere in the repo**, so `pnpm lint` is currently a silent no-op in every package even if wired into CI.
- **`typecheck` script is not a real typecheck** in every package (`"tsc -b --noEmit false"`) — `tsc -b` (project-reference build mode) always emits regardless of `--noEmit`'s value, so this script performs the same full compile-and-emit as `build`. Likely a copy/paste artifact; should be `tsc -b --noEmit` or removed as redundant.
- **No `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, or PR template** anywhere in the repo.
- **`release.yml` grants `contents: write`/`pull-requests: write` but not `id-token: write`** — needed for npm provenance attestations, a reasonable supply-chain hardening step for a public-npm-scoped package that's currently absent.
- **No versioning/migration policy** in the spec beyond "currently only `1.0.0` is supported" — nothing about what a future `1.1.0`/`2.0.0` bump means for existing documents.
- **Enum values are scattered** across the spec rather than consolidated in one appendix, and `expectedDurationUnit`'s actual enum (`"days"|"weeks"|"months"`, from `primitives.ts:30-31`) isn't documented at all — the table just shows type `—`.
- **The `work` field is almost entirely undocumented** beyond a one-line table entry, despite two of the four ACME example teams using `work.waysOfWorking`.
- A pending, unreleased changeset (`.changeset/merge-parallel-mermaid-edges.md`, committed 2026-07-18) hasn't gone through a "Version Packages" release yet — five days is not alarming, but worth a nudge if the intent was to ship the parallel-edges Mermaid fix.

**Explicitly verified as correct (no action needed):** every diagram, JSON sample, and transcript
in the root README was checked field-by-field against `examples/acme-org` and the current code —
topology/context-map/hierarchy/org-hierarchy diagrams, the cognitive-load JSON, the
`find_service_owner` example, the `--debug` tool-call payloads, and the CrewAI `agents.yaml`
sample all matched exactly. This is a strong sign the example-driven documentation is treated as a
living contract, not just prose — worth preserving as new features are documented going forward.

---

## 4. Cross-cutting theme: triplicated tool logic

The same ~12 "org graph query" operations (list teams, get team, cognitive load, service lookup,
interactions, context map, diagrams, search) are implemented **three separate times** — once as
MCP tool handlers (`packages/mcp-server/src/tools/register.ts`), once as Anthropic tool-use
handlers (`packages/chat/src/tools.ts`), and once as REST routes
(`packages/rest-api/src/routes/*.ts`) — each with its own hand-written Zod/JSON-Schema input
validation and its own error-shaping convention. All three do correctly delegate the actual *data*
logic to shared `@jgalego/teamapi-core` functions (so answers are consistent), but the **schema
definitions, descriptions, and error-handling conventions are not shared**, and this report found
concrete drift already: the team-type enum is hand-copied in two places, `find_service_owner`'s
match semantics aren't disclosed consistently, and `chat`'s error signaling is weaker than MCP's.

**Recommendation:** extract one shared "tool contract" module in `packages/core` (or a new small
package) — Zod schemas + descriptions + a uniform `Result<T>`-style success/error wrapper — and
have all three surfaces (`mcp-server`, `chat`, `rest-api`) import from it instead of re-declaring.
This would also fix finding 1.5 (`roleEdges` omission) at the source instead of in two places.

---

## 5. Test coverage summary (biggest gaps, ranked)

1. `packages/cli/src/commands/chat.ts` — **zero coverage**, the actual user-facing chat command.
2. `packages/core/src/model/queries.ts`, `serialize/team-dto.ts`, `resolve/store.ts`,
   `validate/format-errors.ts`, `HttpLoader` — **zero coverage**, despite being the shared layer
   every other package depends on for correctness.
3. `packages/cli`'s Commander wiring in `main.ts` — every CLI test bypasses argument parsing
   entirely by calling `run*` functions directly, so flag-level bugs (enum validation, `--port`,
   `--version`) are invisible to CI.
4. `packages/rest-api`: `/teams/:id/dependencies`, `/teams/:id/roles`, `/services` list,
   `/diagrams/hierarchy/:teamId`, `/cognitive-load/:teamId`, `dot` format branches, `/docs`.
5. `packages/mcp-server`: 7 of 12 tools never actually invoked in tests (name-checked only).
6. `packages/chat`: 10 of 12 tool adapters never invoked (name-checked only in `tools.test.ts`).
7. No end-to-end test anywhere feeds a genuinely schema-invalid document through
   `buildOrgGraph` to verify the `formatZodError` output — arguably the single most common
   real-world failure mode (a hand-edited `teamapi.yml` with a typo).
8. Cycle-detection tests cover only interaction/dependency refs — no platform-ref cycle,
   self-reference, or cross-team role-ref cycle test exists.

---

## 6. Expansion opportunities

- **`get_team_dependencies` MCP tool** to close the REST/MCP capability gap (§2, mcp-server).
- **`roleEdges` on `/graph` and `get_org_graph`** (§1.5) — turns an already-computed data
  structure into a real, queryable capability instead of diagram-only output.
- **Response/error schemas in the OpenAPI spec** for the REST API's very real 400/404 paths.
- **`outputSchema`/`structuredContent` on MCP tools** — every tool is JSON-shaped today but
  returns an opaque stringified blob; MCP clients that support structured output get nothing to
  validate against.
- **A copy-pasteable Claude Desktop/Code `mcpServers` config snippet** in the mcp-server README —
  currently just says "point Claude Desktop at this command," a common real-world setup
  stumbling block (PATH/absolute-binary-path issues) that a ready-made JSON block would prevent.
- **A `CONTRIBUTING.md` and `SECURITY.md`**, plus wiring `lint`/`typecheck` into CI once an
  ESLint config actually exists.
- **A worked `x-*` vendor-extension example** in `examples/acme-org` — the feature is documented
  in the spec but not exercised anywhere, so it's untested by construction.
- **Consolidated enum appendix** in the spec (all `InteractionMode`/`ContextMappingPattern`/
  `DependencyType`/`TeamType`/`expectedDurationUnit` values in one table) instead of scattered
  inline mentions.

---

## Appendix: reviewers and files covered

Seven independent deep-dive passes fed this report: `packages/schema`, `packages/core`,
`packages/cli`, `packages/rest-api`, `packages/mcp-server`, `packages/chat`, and a repo-wide pass
over `docs/spec/teamapi-extended-v1.md`, `examples/acme-org/**`, CI/release workflows, and
changesets config. Two pairs of independent findings overlapped (the same-team `reportsTo`
validation gap surfaced from both the schema and core reviews; the `roleEdges` omission surfaced
from both the mcp-server and rest-api reviews) — those are merged into single findings above (§1.1,
§1.5) rather than listed twice, which is a reasonable confidence signal that both are real.
