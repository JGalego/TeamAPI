import type { OrgGraph } from "../model/org-graph";
import type { DiagramEdge, DiagramModel } from "./diagram-model";
import { labelForRole, membersByRole } from "./role-label";

function nodeId(teamId: string, roleId: string): string {
  return `${teamId}__${roleId}`;
}

/**
 * Org-wide role hierarchy: every team's `roles[]`, grouped into one box per team, with two
 * clearly distinct edge kinds — a solid arrow for formal `reportsTo`/`reportsToRef` (same-team
 * or cross-team) and a dashed "aligns with" arrow for `alignsWith` (dotted-line/matrix
 * relationships, e.g. a community-of-practice lead a role coordinates with but doesn't report
 * to).
 */
export function buildOrgHierarchyDiagram(graph: OrgGraph): DiagramModel {
  const teams = [...graph.teams.values()].sort((a, b) => a.id.localeCompare(b.id));

  const groups = teams.map((team) => ({ id: team.id, label: team.doc.info.name }));

  const nodes = teams.flatMap((team) => {
    const roleMembers = membersByRole(team);
    return [...team.doc.roles]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((role) => ({
        id: nodeId(team.id, role.id),
        label: labelForRole(role, roleMembers.get(role.id)),
        kind: role.kind,
        groupId: team.id,
      }));
  });

  const edges: DiagramEdge[] = [];

  // Same-team reportsTo: manager -> report, arrowed solid line (like the reference "reports to").
  for (const team of teams) {
    for (const role of team.doc.roles) {
      if (role.reportsTo) {
        edges.push({
          id: `e${edges.length}`,
          from: nodeId(team.id, role.reportsTo),
          to: nodeId(team.id, role.id),
          style: "solid",
        });
      }
    }
  }

  // Cross-team role relationships, resolved during graph-building.
  for (const roleEdge of graph.roleEdges) {
    if (roleEdge.kind === "reports-to") {
      edges.push({
        id: `e${edges.length}`,
        from: nodeId(roleEdge.toTeam, roleEdge.toRole),
        to: nodeId(roleEdge.fromTeam, roleEdge.fromRole),
        style: "solid",
      });
    } else {
      edges.push({
        id: `e${edges.length}`,
        from: nodeId(roleEdge.fromTeam, roleEdge.fromRole),
        to: nodeId(roleEdge.toTeam, roleEdge.toRole),
        style: "dashed",
        label: "aligns with",
      });
    }
  }

  return { title: "Organization Hierarchy", direction: "TD", nodes, edges, groups };
}
