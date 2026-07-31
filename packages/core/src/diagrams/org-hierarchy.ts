import type { OrgGraph, RoleGraphEdge } from "../model/org-graph";
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
export interface OrgHierarchyOptions {
  /**
   * Draw each team's declared `agents[]` alongside its roles, attached to the role their `ownerId`
   * fills. Off by default, so the rendering every existing consumer already depends on — including
   * the README's committed Mermaid — is unchanged.
   *
   * Agents are drawn as participants but never as boxes in the chart: an agent placed in the
   * hierarchy the way a person is would suggest accountability sits with it, when it never does.
   * So an agent hangs off the human who owns it by a dotted "supervises" edge, and an agent with
   * no resolvable owner gets no incoming edge at all — it visibly floats, which is exactly what
   * an unowned agent is.
   */
  includeAgents?: boolean;
}

function agentNodeId(teamId: string, agentId: string): string {
  return `${teamId}__agent__${agentId}`;
}

export function buildOrgHierarchyDiagram(graph: OrgGraph, options: OrgHierarchyOptions = {}): DiagramModel {
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

  if (options.includeAgents) {
    for (const team of teams) {
      const roleIdsByMember = new Map(team.doc.members.map((m) => [m.id, m.roleIds]));
      const declaredRoles = new Set(team.doc.roles.map((r) => r.id));

      for (const agent of [...team.doc.agents].sort((a, b) => a.id.localeCompare(b.id))) {
        const suffix = agent.status === "active" ? "agent" : `agent, ${agent.status}`;
        nodes.push({
          id: agentNodeId(team.id, agent.id),
          label: `🤖 ${agent.name} (${suffix})`,
          kind: "agent",
          groupId: team.id,
        });

        const ownerRole = (roleIdsByMember.get(agent.ownerId ?? "") ?? []).find((id) => declaredRoles.has(id));
        if (!ownerRole) continue;
        edges.push({
          id: `e${edges.length}`,
          from: nodeId(team.id, ownerRole),
          to: agentNodeId(team.id, agent.id),
          style: "dotted",
          label: "supervises",
        });
      }
    }
  }

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

  // Cross-team role relationships, resolved during graph-building. An exhaustive map rather than
  // an `else`, so adding a relation kind is a compile error here instead of a silent mislabel.
  const INFORMAL_LABEL: Record<Exclude<RoleGraphEdge["kind"], "reports-to">, string> = {
    "aligns-with": "aligns with",
    advises: "advises",
    "learns-from": "learns from",
    "community-of-practice": "community of practice",
  };

  for (const roleEdge of graph.roleEdges) {
    if (roleEdge.kind === "reports-to") {
      edges.push({
        id: `e${edges.length}`,
        from: nodeId(roleEdge.toTeam, roleEdge.toRole),
        to: nodeId(roleEdge.fromTeam, roleEdge.fromRole),
        style: "solid",
      });
      continue;
    }
    edges.push({
      id: `e${edges.length}`,
      from: nodeId(roleEdge.fromTeam, roleEdge.fromRole),
      to: nodeId(roleEdge.toTeam, roleEdge.toRole),
      style: "dashed",
      label: INFORMAL_LABEL[roleEdge.kind],
    });
  }

  return { title: "Organization Hierarchy", direction: "TD", nodes, edges, groups };
}
