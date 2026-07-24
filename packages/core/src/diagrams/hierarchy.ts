import type { OrgGraph, TeamId } from "../model/org-graph";
import type { DiagramModel } from "./diagram-model";
import { labelForRole, membersByRole } from "./role-label";

/** Per-team role/reporting hierarchy chart, built from `roles[]` (positions) and `reportsTo`,
 * annotated with any `members[]` currently assigned to each role. */
export function buildHierarchyDiagram(graph: OrgGraph, teamId: TeamId): DiagramModel {
  const team = graph.teams.get(teamId);
  if (!team) {
    throw new Error(`Unknown team id: ${teamId}`);
  }

  const roles = [...team.doc.roles].sort((a, b) => a.id.localeCompare(b.id));
  const roleMembers = membersByRole(team);

  const nodes = roles.map((role) => ({
    id: role.id,
    label: labelForRole(role, roleMembers.get(role.id)),
    kind: role.kind,
  }));
  // Edges point manager -> report (not report -> manager) so a top-down layout naturally
  // places managers above their reports, like a conventional org chart.
  const edges = roles
    .filter((role) => role.reportsTo)
    .map((role, i) => ({
      id: `e${i}`,
      from: role.reportsTo as string,
      to: role.id,
      style: "plain" as const,
    }));

  return { title: `${team.doc.info.name} — Role Hierarchy`, direction: "TD", nodes, edges };
}
