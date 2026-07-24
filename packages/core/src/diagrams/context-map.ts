import type { ContextMap } from "../context-map/derive";
import type { OrgGraph, TeamId } from "../model/org-graph";
import type { DiagramModel } from "./diagram-model";

export function buildContextMapDiagram(graph: OrgGraph, contextMap: ContextMap, scopeTeamId?: TeamId): DiagramModel {
  const ids = new Set<TeamId>();
  for (const rel of contextMap.relationships) {
    ids.add(rel.from);
    ids.add(rel.to);
  }

  const nodes = [...ids].sort().map((id) => ({ id, label: graph.teams.get(id)?.doc.info.name ?? id }));
  const edges = contextMap.relationships.map((rel, i) => ({
    id: `e${i}`,
    from: rel.from,
    to: rel.to,
    label: rel.pattern ? `${rel.pattern}${rel.source === "heuristic" ? " (inferred)" : ""}` : "unclassified",
  }));

  return { title: scopeTeamId ? `Context Map — ${scopeTeamId}` : "Context Map", nodes, edges };
}
