import type { GraphEdge, OrgGraph, TeamId } from "../model/org-graph";
import type { DiagramEdge, DiagramModel } from "./diagram-model";

/** Team-interaction topology organigram: all teams (or one team's neighborhood) as nodes, with
 * interactions/dependencies/platform-membership as edges. */
export function buildTopologyDiagram(graph: OrgGraph, teamId?: TeamId): DiagramModel {
  const allIds = [...graph.teams.keys()].sort();
  const relevantIds = teamId ? new Set(neighborhoodOf(graph, teamId)) : new Set(allIds);

  const nodes = allIds
    .filter((id) => relevantIds.has(id))
    .map((id) => {
      const team = graph.teams.get(id)!;
      return { id, label: team.doc.info.name, kind: team.doc.info.type };
    });

  const edges = graph.edges
    .filter((e) => relevantIds.has(e.from) && relevantIds.has(e.to))
    .filter((e) => (teamId ? e.from === teamId || e.to === teamId : true))
    .map((e, i) => edgeToDiagramEdge(e, i));

  return { title: teamId ? `Topology — ${teamId}` : "Organization Topology", nodes, edges };
}

function neighborhoodOf(graph: OrgGraph, teamId: TeamId): TeamId[] {
  const ids = new Set<TeamId>([teamId]);
  for (const e of graph.edges) {
    if (e.from === teamId) ids.add(e.to);
    if (e.to === teamId) ids.add(e.from);
  }
  return [...ids].sort();
}

function edgeToDiagramEdge(e: GraphEdge, index: number): DiagramEdge {
  const id = `e${index}`;
  switch (e.kind) {
    case "interaction":
      return {
        id,
        from: e.from,
        to: e.to,
        label: e.mode,
        style: e.mode === "facilitating" ? "dashed" : "solid",
      };
    case "dependency":
      return {
        id,
        from: e.from,
        to: e.to,
        label: `depends (${e.type})`,
        style: e.type === "Blocking" ? "solid" : "dotted",
      };
    case "platform":
      return { id, from: e.from, to: e.to, label: "platform", style: "dotted" };
  }
}
