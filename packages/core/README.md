# @jgalego/teamapi-core

[![npm](https://img.shields.io/npm/v/%40jgalego%2Fteamapi-core?logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/@jgalego/teamapi-core)
[![CI](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml/badge.svg)](https://github.com/JGalego/TeamAPI/actions/workflows/ci.yml)
[![Node](https://img.shields.io/node/v/%40jgalego%2Fteamapi-core?logo=node.js&logoColor=white&color=339933)](https://nodejs.org)
[![License: MIT](https://img.shields.io/github/license/JGalego/TeamAPI)](https://github.com/JGalego/TeamAPI/blob/main/LICENSE)

`$ref` resolution, org graph building, cognitive load scoring, DDD context-map derivation, and
Mermaid/DOT diagram generation for the [Team API as Code](https://github.com/JGalego/TeamAPI)
extended spec.

This is the shared engine behind the `teamapi` CLI, the REST API, the MCP server, and the chat
tool-use loop — you normally don't depend on it directly unless you're building another adapter
on top of the same org graph.

## Install

```bash
npm install @jgalego/teamapi-core @jgalego/teamapi-schema
```

## Usage

```ts
import { buildOrgGraph, buildTopologyDiagram, toMermaid } from "@jgalego/teamapi-core";

// seedUris are resolved file paths (expand any globs yourself, e.g. with `fast-glob`)
const graph = await buildOrgGraph({ seedUris: ["./examples/acme-org/stream-checkout/teamapi.yml"] });
console.log(toMermaid(buildTopologyDiagram(graph)));
```

## Exports

- **Resolution**: `buildOrgGraph`, `OrgGraphStore` (a live, reloadable wrapper around
  `buildOrgGraph`), `LoaderRegistry`/`FileLoader`/`HttpLoader` (`resolve/loaders`),
  `formatZodError` (turns a Zod validation failure into a readable message).
- **Model**: `OrgGraph`, `GraphEdge`, `RoleGraphEdge`, `ResolvedTeam` types (`model/org-graph`);
  `listTeams`, `getTeam`, `getInteractions`, `getDependencies`, `listServices`,
  `findServiceOwner`, `listRoles`, `listMembers`, `searchOrg` (`model/queries`).
- **Cognitive load**: `scoreCognitiveLoad`, `orgWideCognitiveLoadReport`
  (`cognitive-load/score`).
- **Gaps**: `planGaps`, `formatGaps` (`gaps/plan`) — the accountability holes _between_ teams,
  which are invisible from any single `teamapi.yml` and only appear once the graph is resolved.
  Pure: no I/O, no network.
- **Shadow AI**: `scanForAiArtifacts` (`shadow-ai/scan`) reads repository checkouts already on
  disk for MCP configs, agent instruction files, LLM SDKs in manifests and workflow steps that
  call a model; `planShadowAi`/`formatShadowAi`/`repoNameFromUrl` (`shadow-ai/plan`) reconcile
  what it found against what teams declare in `agents[]`.
- **DDD context mapping**: `deriveContextMap`, `MODE_TO_PATTERN_HEURISTIC`
  (`context-map/derive`, `context-map/patterns`).
- **Diagrams**: `buildTopologyDiagram`, `buildHierarchyDiagram`, `buildOrgHierarchyDiagram`,
  `buildContextMapDiagram` (one per `--scope`), plus `toMermaid`/`toDot` renderers and the
  `DiagramModel` type they share.
- **Serialization**: `toTeamSummaryDto`, `toTeamDetailDto`, `listTeamSummaries`,
  `toOrgGraphDto` (`serialize/team-dto`) — the single source of truth both the REST API and the
  MCP server use to turn a `ResolvedTeam`/`OrgGraph` into a wire-format object, so their
  responses are identical by construction.
- **Generators**: `buildCrewAiCrewConfig`/`buildCrewAiOrgConfig` plus the
  `toCrewAiCrewYaml`/`toCrewAiOrgYaml` serializers (`generators/crewai`) — turn a team's (or the
  whole org's) roles into CrewAI `agents.yaml`/`tasks.yaml`. `buildBackstageCatalog`/
  `buildBackstageOrgCatalog` plus `toBackstageYaml` (`generators/backstage`) — turn a team's (or
  the whole org's) `services[]`/`members[]` into a Backstage `catalog-info.yaml`
  (`Group`/`User`/`System`/`Component` entities).
- **Diffing**: `diffOrgGraphs`, `isEmptyDiff`, `formatOrgGraphDiff` (`diff/diff-graph`) — diff two
  resolved `OrgGraph`s (teams added/removed, per-team role/member/service/cognitive-load changes,
  edge changes) and render the result as a human-readable report. Git-agnostic — `teamapi diff`
  is what supplies "the org as of a git revision" as one side of the comparison.
- **History**: `listRevisions`, `sampleRevisions`, `snapshotOrg`, `withChurn`, `formatHistory`,
  `historyToCsv` (`history/trends`, `git/ref-loader`) — the org resolved at a series of past git
  revisions, as a trend rather than a pair of snapshots.
- **Digest**: `buildOrgDigest`, `formatDigestText`, `digestToSlackMessage`, `digestToHtml`
  (`digest/build`) — gaps + policy + topology merged with what moved since a previous snapshot.
- **Metrics**: `collectOrgMetrics`, `renderPrometheus` (`metrics/*`) — the org graph in the
  Prometheus exposition format, reused by `serve-api --metrics`.
- **Semantic search**: `semanticSearchOrg`, `buildSearchDocuments`, `OpenAiEmbeddingProvider`,
  `EmbeddingCache`, `createEmbeddingScorer` (`search/*`) — embedding-backed search and
  context-bundle scoring over any OpenAI-compatible `/embeddings` endpoint.
- **Importers**: `importBackstageCatalog`, `importDirectoryGroups` (Okta/Entra),
  `importSlackChannels`, `importCsvRoster` (`import/*`) — bootstrap documents from the systems an
  org already has.
- **Write-back planners**: `planSlackUsergroups`, `planOktaGroups`, `planPagerDutyTeams`
  (`apply/*`) — plan/execute reconciliation of memberships in external systems, same
  plan-then-confirm shape as the GitHub `apply`.
- **Proposals**: `buildTeamProposal`, `openTeamProposal` (`propose/*`) — a small, closed patch to
  one team document becomes a pull request, re-validated and re-formatted first.

Full docs: **https://github.com/JGalego/TeamAPI**

## The TeamAPI toolchain

One org graph, seven doors into it — install only the ones you need:

| Package                                                                                    | What it does                                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [`@jgalego/teamapi`](https://www.npmjs.com/package/@jgalego/teamapi)                       | The CLI — validate, diagram, check, import, reconcile, serve and chat with your org |
| **`@jgalego/teamapi-core`** (this package)                                                 | The engine: `$ref` resolution, the org graph, scoring, checks, diagrams, generators |
| [`@jgalego/teamapi-schema`](https://www.npmjs.com/package/@jgalego/teamapi-schema)         | Zod schemas and TypeScript types for the extended spec                              |
| [`@jgalego/teamapi-rest-api`](https://www.npmjs.com/package/@jgalego/teamapi-rest-api)     | REST API, live dashboard, Swagger UI, Prometheus metrics                            |
| [`@jgalego/teamapi-mcp-server`](https://www.npmjs.com/package/@jgalego/teamapi-mcp-server) | The org graph as MCP tools for LLM assistants                                       |
| [`@jgalego/teamapi-chat`](https://www.npmjs.com/package/@jgalego/teamapi-chat)             | Chat as a team or member — Anthropic or any OpenAI-compatible endpoint              |
| [`@jgalego/teamapi-backstage`](https://www.npmjs.com/package/@jgalego/teamapi-backstage)   | Live Backstage catalog entity provider                                              |

Docs, examples and the extended spec: **[teamapi.dev](https://teamapi.dev/latest/index.html)** · **[github.com/JGalego/TeamAPI](https://github.com/JGalego/TeamAPI)**

## License

MIT
