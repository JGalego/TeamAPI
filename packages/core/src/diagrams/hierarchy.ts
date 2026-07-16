import type { OrgGraph, TeamId } from "../model/org-graph";
import type { DiagramModel } from "./diagram-model";

/** Per-team role/reporting hierarchy chart, built from `roles[]` (positions) and `reportsTo`,
 * annotated with any `members[]` currently assigned to each role. */
export function buildHierarchyDiagram(graph: OrgGraph, teamId: TeamId): DiagramModel {
  const team = graph.teams.get(teamId);
  if (!team) {
    throw new Error(`Unknown team id: ${teamId}`);
  }

  const roles = [...team.doc.roles].sort((a, b) => a.id.localeCompare(b.id));
  const membersByRole = new Map<string, string[]>();
  for (const member of team.doc.members) {
    for (const roleId of member.roleIds) {
      const names = membersByRole.get(roleId) ?? [];
      names.push(member.name);
      membersByRole.set(roleId, names);
    }
  }

  const nodes = roles.map((role) => {
    const memberNames = membersByRole.get(role.id);
    const label = memberNames?.length
      ? `${role.name} (${role.kind}) — ${memberNames.join(", ")}`
      : `${role.name} (${role.kind}) — vacant`;
    return { id: role.id, label, kind: role.kind };
  });
  const edges = roles
    .filter((role) => role.reportsTo)
    .map((role, i) => ({ id: `e${i}`, from: role.id, to: role.reportsTo as string, label: "reports to" }));

  return { title: `${team.doc.info.name} — Role Hierarchy`, nodes, edges };
}
