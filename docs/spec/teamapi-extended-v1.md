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

**Versioning and migration.** `teamApiVersion` is a closed set validated against a registry of
supported versions (`SCHEMA_REGISTRY` in `packages/schema/src/index.ts`), currently just
`"1.0.0"`. A document declaring an unsupported version fails validation rather than being parsed
against the wrong schema. There is no `1.x` deprecation policy yet, since no second version has
shipped — when one does, expect it to be additive (new optional fields) where possible, with a
breaking change reflected as a new registry entry rather than silently changing `"1.0.0"`'s
meaning out from under existing documents.

## File format and layout

Same conventions as the base spec: one file per team, YAML or JSON (a strict JSON-compatible
subset of YAML 1.2), conventionally named `teamapi.yml`. Teams reference each other across
files/repos via `$ref`, resolved by this toolchain as **whole-document references only** (no
JSON-pointer fragments into another team's nested fields) in exactly five places:

- `platform.$ref` — the platform team this team's services build on.
- `interactions[].$ref` — the other team in each Team Topologies interaction.
- `dependencies[].$ref` — the other team in each dependency.
- `roles[].reportsToRef.$ref` — the team owning a role's cross-team manager.
- `roles[].alignsWith[].$ref` — the team owning a role's cross-team dotted-line relationship.

`work.*[].$ref` is *not* traversed by the resolver — it points at repos, wikis, or other non-team
resources, and `$ref` is optional there.

Every object in the schema allows unknown `x-*`-style vendor extension fields (JSON Schema
`.passthrough()`), so teams can attach organization-specific metadata without forking the schema —
see `x-pagerduty-service` on the `ledger` service in
[`examples/acme-org/platform-payments/teamapi.yml`](../../examples/acme-org/platform-payments/teamapi.yml)
for a worked example.

## Root object

Several fields below are typed `slug`: a lowercase kebab-case identifier matching
`^[a-z0-9]+(-[a-z0-9]+)*$` (e.g. `stream-checkout`, `head-of-engineering`) — not a display name,
which is what `info.name`/`role.name`/`member.name` are for.

| Field | Type | Required | Description |
|---|---|---|---|
| `teamApiVersion` | `"1.0.0"` | Yes | Version of this extended spec. |
| `id` | slug | Yes | Stable identifier used for `$ref` linking (matched against another team's `id` once its `$ref`'d document is resolved — a referencing document itself only ever carries a `$ref` path/URL plus a human-readable `teamName`, never the target's `id` directly). Never renamed once other teams reference it — `info.name` is the renameable display label instead. |
| `info` | [Info](#info) | Yes | Core team identity. |
| `channels` | [Channel](#channel) | No | Communication channels. |
| `searchTerms` | [SearchTerm](#searchterm) | No | Free-text terms for org-wide search. |
| `platform` | [Ref](#ref) | No | The platform team this team's services are built on. |
| `services` | [Service](#services-and-bounded-contexts) | No | Services/software owned by this team. |
| `work` | [Work](#work) | No | Current work items (not traversed as team-graph edges). |
| `roles` | [Role](#role) | No | Positions/functions within the team. |
| `members` | [Member](#member) | No | People on the team, optionally assigned to roles. |
| `cognitiveLoad` | [CognitiveLoadAssessment](#cognitiveloadassessment) | No | Self-assessment. |
| `meetings` | [Meeting](#meeting) | No | Recurring meetings. |
| `interactions` | [Interaction](#interactions-and-context-mapping) | No | Team Topologies interactions with other teams. |
| `dependencies` | [Dependency](#dependencies) | No | Dependencies on other teams. |
| `agents` | [Agent](#ai-native-domains) | No | AI assistants treated as first-class team participants. |
| `memory` | [MemoryEntry](#ai-native-domains) | No | Persistent organizational memory. |
| `specifications` | [Specification](#ai-native-domains) | No | Specification-driven-development artifacts. |
| `steeringDocuments` | [SteeringDocument](#ai-native-domains) | No | Coding standards, conventions, principles — inheritable org->team->project. |
| `prompts` | [Prompt](#ai-native-domains) | No | Version-controlled, renderable prompt library. |
| `playbooks` | [Playbook](#ai-native-domains) | No | Structured operational procedures. |
| `policies` | [Policy](#ai-native-domains) | No | Machine-readable governance for external automation. |
| `knowledgeBase` | [KnowledgeBaseEntry](#ai-native-domains) | No | ADRs, FAQs, meeting notes, runbooks, design docs. |
| `workflows` | [Workflow](#ai-native-domains) | No | Process state machines, independent of any CI/CD system. |
| `sessions` | [AiSession](#ai-native-domains) | No | Record of AI collaboration sessions. |

## Info

`{ name: string, focus?: string, type: "stream-aligned" | "platform" | "complicated-subsystem" | "enabling" }`

## Channel

A communication channel for reaching the team.

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | string | Yes | The channel medium, e.g. `"slack"`, `"email"`, `"teams"` — not an enum, since organizations use different tools. |
| `name` | string | Yes | The channel identifier within that medium, e.g. a Slack channel name. |

## SearchTerm

A free-text term surfaced by org-wide search (`searchOrg`/`GET /search`/`search_org`) in addition
to whatever's already searchable on the team (name, focus, services, roles, members) — useful for
synonyms, former team names, or jargon someone might search for that doesn't appear verbatim
elsewhere in the document.

| Field | Type | Required | Description |
|---|---|---|---|
| `term` | string | Yes | The searchable text. |

## Ref

The base shape used everywhere this spec links to another team's document: a required `$ref`
(a relative file path or absolute URL, resolved by the toolchain's loader) allowing unknown
vendor-extension fields via passthrough. `platform` is exactly this shape with no additional
fields; [RoleRef](#roleref), [Interaction](#interactions-and-context-mapping), and
[Dependency](#dependencies) all extend it with their own additional fields (`teamName` plus
whatever else each needs).

| Field | Type | Required | Description |
|---|---|---|---|
| `$ref` | string | Yes | Path or URL to the target team's document. |

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
| `responsibilities` | [Responsibility](#responsibility)[] | No | What this role owns. |
| `reportsTo` | slug | No | Another role's `id` within the same team. Validated: must match an existing role in this team's `roles[]`, and same-team `reportsTo` cycles (including a role reporting to itself) are rejected. |
| `reportsToRef` | [RoleRef](#roleref) | No | Formal reporting line to a role on another team. **Mutually exclusive with `reportsTo`** — a document setting both fails validation, since a role reports to exactly one manager, same-team or not. |
| `alignsWith` | [RoleRef](#roleref)[] | No | Dotted-line/matrix relationships that aren't formal reporting, e.g. a community-of-practice lead this role coordinates with. Same-team or cross-team. |

### Responsibility

A plain string, or an object pairing the responsibility with an optional `doneWhen` — a definition of done, for consumers that need one (e.g. `teamapi generate crewai`, where it becomes a task's `expected_output`). Most consumers (diagrams, REST API, MCP tools) have no use for `doneWhen`, so it's never required — plain strings remain valid everywhere.

| Field | Type | Required | Description |
|---|---|---|---|
| `text` | string | Yes | The responsibility itself, same content as the plain-string form. |
| `doneWhen` | string | No | What "done" looks like for this responsibility. |

```yaml
responsibilities:
  - Payments platform architecture           # plain string — no doneWhen
  - text: On-call escalation point
    doneWhen: A runbook exists and the on-call rotation is staffed for the current quarter.
```

### RoleRef

A reference to another team's role — same `$ref` convention as `Interaction`/`Dependency`.

| Field | Type | Required | Description |
|---|---|---|---|
| `teamName` | string | Yes | Human-readable label for the target team, kept inline alongside `$ref`. |
| `roleId` | slug | Yes | The target role's `id` within the referenced team's `roles[]`. |
| `$ref` | string | Yes | Path/URL to the target team's document. |

### Member

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | slug | Yes | Unique within this team's `members[]`. |
| `name` | string | Yes | The person's name. |
| `contact` | string | No | Email or other contact info. |
| `roleIds` | slug[] | No | Zero or more `roles[].id` this member currently fills. |
| `allocation` | number (0-100) | No | FTE % this member allocates to this team. |
| `githubUsername` | string | No | GitHub login, used by `teamapi apply`/`teamapi import github-org` to resolve this member to a real account. |

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

`@jgalego/teamapi-core`'s `scoreCognitiveLoad` derives a `sustainable | elevated | overloaded` label,
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

## Work

Point-in-time work items — deliberately **not** resolved into graph edges (see
[File format and layout](#file-format-and-layout)), since they describe transient work rather than
a standing team-to-team relationship. Each of the three arrays holds the same shape: a required
`name` plus an optional `$ref` to a repo, wiki page, ticket, or other resource (not necessarily
another team's `teamapi.yml`).

| Field | Type | Required | Description |
|---|---|---|---|
| `services` | NamedRef[] | No | Work items tied to a specific service this team owns. |
| `waysOfWorking` | NamedRef[] | No | Practices/playbooks the team follows (e.g. "Trunk-based development"). |
| `crossTeam` | NamedRef[] | No | Cross-team initiatives this team is currently part of. |

`NamedRef`: `{ name: string, $ref?: string }`, allowing unknown vendor-extension fields.

```yaml
work:
  waysOfWorking:
    - name: Trunk-based development
```

## Meeting

A recurring meeting.

| Field | Type | Required | Description |
|---|---|---|---|
| `purpose` | string | Yes | What the meeting is for, e.g. `"daily sync"`. |
| `dayOfWeek` | string | No | e.g. `"Tuesday"` — a free-text day name, not an enum. |
| `timeOfDay` | string | No | e.g. `"09:30"` — a free-text time, no enforced format. |
| `durationMinutes` | positive integer | No | How long the meeting runs. |

## Interactions and context mapping

`Interaction` extends the base spec's shape with an optional `contextMappingPattern`:

| Field | Type | Required |
|---|---|---|
| `teamName` | string | Yes |
| `mode` | `collaboration \| x-as-a-service \| facilitating` | Yes |
| `purpose` | string | No |
| `startDate` | string (free-text; no enforced date format) | No |
| `expectedDuration` | positive number | No |
| `expectedDurationUnit` | `days \| weeks \| months` | No |
| `contextMappingPattern` | `Partnership \| CustomerSupplier \| Conformist \| OpenHostService \| AnticorruptionLayer \| SharedKernel` | No |
| `$ref` | string | Yes |

When `contextMappingPattern` is omitted, `@jgalego/teamapi-core`'s `deriveContextMap` applies a heuristic:

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

## AI-native domains

Ten sections, all additive/optional/`.default([])`, so a document written before they existed
still parses identically. Every resource in every array below requires a slug `id`, unique within
that array (validated the same way `roles[].id`/`members[].id` are). Every array-of-objects field
not called out below (`capabilities`, `tags`, `reviewers`, etc.) is a plain string array.

**Agent**: `{ id, name, description?, provider, model?, role, capabilities: string[], status: "active" | "inactive" | "deprecated" (default "active"), ownerId?: slug (a members[].id), permissions: string[], tags: string[] }`.

**MemoryEntry**: `{ id, title, kind: "architecture-decision" | "convention" | "lesson-learned" | "recurring-issue" | "domain-knowledge" | "historical-decision", body (markdown), tags: string[], contributors: string[], relatedRefs: Ref[], createdAt?, updatedAt? }`.

**Specification**: `{ id, title, kind: "requirement" | "design" | "task" | "acceptance-criteria", status: "draft" | "in-review" | "approved" | "in-progress" | "implemented" | "deprecated" (default "draft"), body?, reviewers: string[], approvals: { reviewer, approvedAt?, comment? }[], linkedPullRequests: string[], linkedIssues: string[], linkedDocuments: Ref[], tags: string[] }`. `linkedPullRequests`/`linkedIssues` are plain strings (URLs or `owner/repo#123`), not `$ref`s — they point at GitHub/GitLab/Jira, not another team's document.

**SteeringDocument**: `{ id, title, category: "coding-standards" | "api-conventions" | "security-guidelines" | "architecture-principles" | "documentation-style" | "custom", scope: "organization" | "team" | "project" (default "team"), appliesTo?, body, tags: string[] }`. `@jgalego/teamapi-core`'s `resolveEffectiveSteering(graph, teamId)` returns a team's own documents plus every document declared on the team(s) reachable by walking the existing `platform.$ref` chain upward — reusing that edge rather than inventing a second hierarchy mechanism. A document the team declares itself always wins over an inherited one sharing its `id`.

**Prompt**: `{ id, name, description?, template (with {{variable}} placeholders), variables: { name, description?, required (default false), default? }[], version (default "1.0.0"), versions: { version, template, changelog?, publishedAt? }[], tags: string[], owner? }`. `@jgalego/teamapi-core`'s `renderPrompt(prompt, variables)` fills placeholders, falling back to each variable's `default`, and throws `MissingPromptVariableError` for a `required` variable left unfilled.

**Playbook**: `{ id, name, category: "incident-response" | "release" | "onboarding" | "offboarding" | "production-deployment" | "custom", steps: { order, title, description?, requiredRoles: string[], automationHook? }[], documentation?, attachments: Ref[], tags: string[] }`.

**Policy**: `{ id, name, category: "pr-requirements" | "required-approvals" | "documentation" | "security" | "dependency" | "custom", severity: "info" | "warning" | "blocking" (default "warning"), description?, rules: { key, description?, value? }[], enforcedBy: string[], tags: string[] }`. This schema declares what a policy requires; enforcing it is external automation's job, named (loosely) in `enforcedBy`.

**KnowledgeBaseEntry**: `{ id, title, kind: "adr" | "faq" | "meeting-notes" | "architecture-doc" | "runbook" | "design-doc", category?, body (markdown), relatedRefs: Ref[], attachments: Ref[], tags: string[] }`.

**Workflow**: `{ id, name, description?, states: { id, name, description? }[], transitions: { from, to, trigger }[], automation: { trigger, action }[], tags: string[] }`. Validated: every `transitions[].from`/`.to` must match a declared `states[].id`.

**AiSession**: `{ id, agentId?: slug (an agents[].id), assistant, model?, objective, promptIds: slug[] (this team's prompts[].id), generatedArtifacts: Ref[], referencedDocuments: Ref[], decisions: string[], startedAt?, endedAt?, tags: string[] }`. Written after the fact — a durable record, the same way `meetings[]` records a standing meeting rather than driving one live.

### Context bundles

`@jgalego/teamapi-core`'s `deriveContextBundle(graph, { goal, teamId?, limit? })` (exposed as `POST /context` and the
`get_context_bundle` MCP tool) assembles the specifications, steering documents, policies, memory,
knowledge base entries, prompts, and playbooks most relevant to a stated `goal`, plus (when
`teamId` is given) that team's related teams, members, and services.

Relevance is a heuristic: `goal` is tokenized (lowercased, alphanumeric runs of length >= 3), and
each candidate resource is scored by how many of those tokens appear in its text fields/tags —
returned as `matchedTerms` alongside each result, so the ranking is auditable rather than a black
box. A resource belonging to the scoped `teamId` gets a fixed score boost, so a team's own material
usually outranks equally-relevant org-wide material without burying something more relevant found
elsewhere. This is a v1 scorer — nothing about the interface assumes keyword overlap specifically,
so a semantic/embeddings-based scorer can replace it later without changing the request/response shape.

### Knowledge graph

`@jgalego/teamapi-core`'s `deriveKnowledgeGraph(graph)` (exposed as `GET /knowledge-graph` and the
`get_knowledge_graph` MCP tool) links every team, member, role, service, agent, and AI-native
document into one graph of `{ nodes, edges }`. Edge kinds, each backed by something the schema can
actually resolve:

- **`owns`** — every resource belongs to the team whose document declares it.
- **`fills`** — `members[].roleIds` -> `roles[]`.
- **`reportsTo`/`alignsWith`** — reuses the graph's existing role-level edges.
- **`interaction`/`dependency`/`platform`** — reuses the graph's existing team-level edges.
- **`usedPrompt`/`ranBy`** — `sessions[].promptIds`/`.agentId`, same-team fields needing no `$ref` resolution.
- **`references`** — resolved from `$ref`-bearing fields not otherwise traversed by the graph
  builder (`memory[].relatedRefs`, `specifications[].linkedDocuments`, `knowledgeBase[].relatedRefs`/`.attachments`,
  `playbooks[].attachments`), by resolving each `$ref` against its declaring team's `sourceUri` and
  matching it against another team's `sourceUri`. A `$ref` that doesn't resolve to a known team
  (e.g. a wiki page) is omitted rather than guessed at.

`traverseKnowledgeGraph(graph, nodeId, maxDepth)` (exposed as `GET /knowledge-graph/:nodeId/traverse`
and `traverse_knowledge_graph`) does a breadth-first, edges-treated-as-undirected walk from one
node, for scoping a visualization or answering "what's connected to this ADR."

### Unified search

`searchOrg`/`GET /search`/`search_org` now also covers every AI-native domain — agent, memory,
specification, steeringDocument, prompt, playbook, policy, knowledgeBase, workflow, and session are
all valid `SearchResult.kind` values, matched the same way team/service/role/member always were
(case-insensitive substring, now also over each resource's `tags`).

### Design note: read-only, git-managed, no new persistence

Every AI-native domain above follows the same rule as the rest of this API: **there is no write
path**. A `POST` you might expect from a typical CRUD API (`POST /teams/:id/agents` to register a
new agent, say) does not exist here — an agent, a policy, a prompt is added the same way a role or
a service is: by editing `teamapi.yml` and committing it. The only genuinely new `POST` endpoints
are `POST /context` (a stateless computation over the current graph, not a resource creation) and
`POST /teams/:id/prompts/:promptId/render` (ditto). This preserves the existing architecture's
central property — the YAML documents, versioned in git, are the single source of truth — rather
than bolting on a second, parallel persistence layer that could drift from it.

## Toolchain-generated artifacts

Given a resolved org graph, `@jgalego/teamapi-core` (consumed identically by the REST API, MCP server, and
CLI) can produce:

- **Topology organigram** — team-interaction diagram (Mermaid/DOT), org-wide or scoped to one
  team's neighborhood.
- **Role hierarchy chart** — one team's `roles[]`/`reportsTo` tree, annotated with `members[]`.
- **Org-wide role hierarchy** — every team's roles, grouped into one box per team, with a solid
  arrow for formal reporting (`reportsTo`/`reportsToRef`, same-team or cross-team) and a dashed
  arrow for `alignsWith` (dotted-line/matrix relationships).
- **Context map** — DDD relationship diagram derived from `interactions[]`.
- **Cognitive load report** — per-team or org-wide, sorted by total load.
- **Full graph JSON** — every resolved team plus every edge, for custom tooling.
- **Context bundle** — the goal-relevant slice of specifications/steering/policies/memory/knowledge
  base/prompts/playbooks (see [Context bundles](#context-bundles) above).
- **Knowledge graph** — every team/person/agent/document as linked nodes (see
  [Knowledge graph](#knowledge-graph) above), with breadth-first traversal from any node.

See the root `README.md` (or `packages/cli`) for the CLI commands, REST endpoints, and MCP tools
that expose these.

## Enum reference

Every enum in the schema, in one place (each is also mentioned inline where its field is
documented above):

| Enum | Values | Used by |
|---|---|---|
| Team type | `stream-aligned \| platform \| complicated-subsystem \| enabling` | `info.type` |
| Interaction mode | `collaboration \| x-as-a-service \| facilitating` | `interactions[].mode` |
| Duration unit | `days \| weeks \| months` | `interactions[].expectedDurationUnit` |
| Context-mapping pattern | `Partnership \| CustomerSupplier \| Conformist \| OpenHostService \| AnticorruptionLayer \| SharedKernel` | `interactions[].contextMappingPattern` |
| Dependency type | `OK \| Slowing \| Blocking` | `dependencies[].type` |
| Suggested role kind (not enforced) | `ProductManager \| TechLead \| EngineeringManager \| Engineer \| Designer \| SRE \| DataScientist \| DomainExpert \| DeliveryLead` (`SUGGESTED_ROLE_KINDS`; `roles[].kind` accepts any non-empty string) | `roles[].kind` |
| Agent status | `active \| inactive \| deprecated` | `agents[].status` |
| Memory kind | `architecture-decision \| convention \| lesson-learned \| recurring-issue \| domain-knowledge \| historical-decision` | `memory[].kind` |
| Specification kind | `requirement \| design \| task \| acceptance-criteria` | `specifications[].kind` |
| Specification status | `draft \| in-review \| approved \| in-progress \| implemented \| deprecated` | `specifications[].status` |
| Steering category | `coding-standards \| api-conventions \| security-guidelines \| architecture-principles \| documentation-style \| custom` | `steeringDocuments[].category` |
| Steering scope | `organization \| team \| project` | `steeringDocuments[].scope` |
| Playbook category | `incident-response \| release \| onboarding \| offboarding \| production-deployment \| custom` | `playbooks[].category` |
| Policy category | `pr-requirements \| required-approvals \| documentation \| security \| dependency \| custom` | `policies[].category` |
| Policy severity | `info \| warning \| blocking` | `policies[].severity` |
| Knowledge base kind | `adr \| faq \| meeting-notes \| architecture-doc \| runbook \| design-doc` | `knowledgeBase[].kind` |
