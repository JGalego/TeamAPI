# @jgalego/teamapi-core

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

Full docs: **https://github.com/JGalego/TeamAPI**

## License

MIT
