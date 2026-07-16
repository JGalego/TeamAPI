# Team API Extended Specification (v1)

This document specifies the extended Team API as Code schema used by this toolchain. It is a
superset of [TeamTopologies/TeamAPI-As-Code](https://github.com/TeamTopologies/TeamAPI-As-Code)
v0.1.0, adding role/people definitions, cognitive load self-assessment, and DDD-style bounded
context and context-mapping annotations. The canonical schema is the Zod schema in
[`packages/schema/src/v1`](../../packages/schema/src/v1); this document is a human-readable
mirror of it, in the spirit of the upstream project's own `spec/teamapi.md`.

## Relationship to the base spec

This is a **new, non-strictly-backwards-compatible extension**, not a drop-in replacement. The
root field is `teamApiVersion` (currently only `"1.0.0"` is supported) — a name deliberately
distinct from the upstream `teamapi:` field, so tooling that understands only the base spec and
tooling that understands this extension never mistake one document for the other.

## File format and layout

Same conventions as the base spec: one file per team, YAML or JSON (a strict JSON-compatible
subset of YAML 1.2), conventionally named `teamapi.yml`. Teams reference each other across
files/repos via `$ref`, resolved by this toolchain as **whole-document references only** (no
JSON-pointer fragments into another team's nested fields) in `platform`, `interactions[]`, and
`dependencies[]`. `work.*[].$ref` is *not* traversed by the resolver — it points at repos, wikis,
or other non-team resources, and `$ref` is optional there.

Every object in the schema allows unknown `x-*`-style vendor extension fields (JSON Schema
`.passthrough()`), so teams can attach organization-specific metadata without forking the schema.

## Root object

| Field | Type | Required | Description |
|---|---|---|---|
| `teamApiVersion` | `"1.0.0"` | Yes | Version of this extended spec. |
| `id` | slug | Yes | Stable identifier used for `$ref` linking. Never renamed once other teams reference it — `info.name` is the renameable display label instead. |
| `info` | [Info](#info) | Yes | Core team identity. |
| `channels` | [Channel](#channel)[] | No | Communication channels. |
| `searchTerms` | [SearchTerm](#searchterm)[] | No | Free-text terms for org-wide search. |
| `platform` | [Ref](#ref) | No | The platform team this team's services are built on. |
| `services` | [Service](#service)[] | No | Services/software owned by this team. |
| `work` | [Work](#work) | No | Current work items (not traversed as team-graph edges). |
| `roles` | [Role](#role)[] | No | Positions/functions within the team. |
| `members` | [Member](#member)[] | No | People on the team, optionally assigned to roles. |
| `cognitiveLoad` | [CognitiveLoadAssessment](#cognitiveloadassessment) | No | Self-assessment. |
| `meetings` | [Meeting](#meeting)[] | No | Recurring meetings. |
| `interactions` | [Interaction](#interaction)[] | No | Team Topologies interactions with other teams. |
| `dependencies` | [Dependency](#dependency)[] | No | Dependencies on other teams. |

## Info

`{ name: string, focus?: string, type: "stream-aligned" | "platform" | "complicated-subsystem" | "enabling" }`

## Roles vs. Members

Team Topologies' Team API template asks "who does what," but a **role** (a position, e.g. "Payments
Tech Lead") and a **member** (a specific person) are different things worth keeping separate:

- A role can be **vacant** (hiring in progress) or **job-shared** by more than one member.
- A member can hold **more than one role**, or none at all (a general contributor).
- Reporting lines (`reportsTo`) are a property of the *role* hierarchy, independent of whoever
  currently fills each seat — reorganizing who's in a seat shouldn't rewrite the org chart shape.

### Role

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | slug | Yes | Unique within this team's `roles[]`. |
| `name` | string | Yes | The role's title, e.g. `"Payments Tech Lead"` — **not** a person's name. |
| `kind` | string | Yes | A broad category for filtering/analytics, e.g. `TechLead`, `Engineer`, `Designer`, `SRE` (suggested values in `SUGGESTED_ROLE_KINDS`, not enforced). |
| `responsibilities` | string[] | No | What this role owns. |
| `reportsTo` | slug | No | Another role's `id` within the same team. |

### Member

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | slug | Yes | Unique within this team's `members[]`. |
| `name` | string | Yes | The person's name. |
| `contact` | string | No | Email or other contact info. |
| `roleIds` | slug[] | No | Zero or more `roles[].id` this member currently fills. |
| `allocation` | number (0-100) | No | FTE % this member allocates to this team. |

## CognitiveLoadAssessment

Inspired by [Team-Cognitive-Load-Assessment](https://github.com/TeamTopologies/Team-Cognitive-Load-Assessment):
a 1-10 self-assessment across the three load types from _Team Topologies_.

| Field | Type | Required |
|---|---|---|
| `intrinsic` | number (1-10) | Yes |
| `extraneous` | number (1-10) | Yes |
| `germane` | number (1-10) | Yes |
| `notes` | string | No |
| `assessedOn` | string | No |

`@teamapi/core`'s `scoreCognitiveLoad` derives a `sustainable | elevated | overloaded` label,
weighting `extraneous` load more heavily than the total score — Team Topologies treats extraneous
(avoidable overhead) as the load type teams should actively minimize.

## Services and bounded contexts

`Service`: `{ name, url?, repository?, versioning?: { type }, boundedContext?: BoundedContext }`.

`BoundedContext` (new) lets a team describe a service as a DDD bounded context:

```yaml
boundedContext:
  ubiquitousLanguage:
    - term: Charge
      definition: A single attempt to move money from a customer's payment method
  aggregates: [Charge, Refund]
  publishedEvents: [ChargeAuthorized, ChargeSettled]
  subscribedEvents: []
```

## Interactions and context mapping

`Interaction` extends the base spec's shape with an optional `contextMappingPattern`:

| Field | Type | Required |
|---|---|---|
| `teamName` | string | Yes |
| `mode` | `collaboration \| x-as-a-service \| facilitating` | Yes |
| `purpose`, `startDate`, `expectedDuration`, `expectedDurationUnit` | — | No |
| `contextMappingPattern` | `Partnership \| CustomerSupplier \| Conformist \| OpenHostService \| AnticorruptionLayer \| SharedKernel` | No |
| `$ref` | string | Yes |

When `contextMappingPattern` is omitted, `@teamapi/core`'s `deriveContextMap` applies a heuristic:

| Mode | Inferred pattern |
|---|---|
| `x-as-a-service` | `OpenHostService` |
| `collaboration` | `Partnership` |
| `facilitating` | *(none)* — coaching/enabling relationships aren't a runtime integration pattern |

Each team's interaction declaration is an independent directed edge. If two teams describe the
same relationship with different modes, `deriveContextMap` surfaces it as a `conflict` rather than
silently reconciling — that disagreement is itself useful organizational signal.

## Dependencies

`{ teamName, description?, type: "OK" | "Slowing" | "Blocking", $ref }` — unchanged from the base
spec.

## Toolchain-generated artifacts

Given a resolved org graph, `@teamapi/core` (consumed identically by the REST API, MCP server, and
CLI) can produce:

- **Topology organigram** — team-interaction diagram (Mermaid/DOT), org-wide or scoped to one
  team's neighborhood.
- **Role hierarchy chart** — one team's `roles[]`/`reportsTo` tree, annotated with `members[]`.
- **Context map** — DDD relationship diagram derived from `interactions[]`.
- **Cognitive load report** — per-team or org-wide, sorted by total load.
- **Full graph JSON** — every resolved team plus every edge, for custom tooling.

See the root `README.md` (or `packages/cli`) for the CLI commands, REST endpoints, and MCP tools
that expose these.
