import type { Agent } from "@jgalego/teamapi-schema";
import type { OrgGraph } from "../model/org-graph";

export interface FleetAgent {
  id: string;
  teamId: string;
  agent: Agent;
  ownerResolved: boolean;
  supervision?: number;
}

export interface AgentFleet {
  agents: FleetAgent[];
  summary: {
    total: number;
    active: number;
    unowned: number;
    unscoredSupervision: number;
    providers: Record<string, number>;
  };
}

export interface AgentRouteRequest {
  capability: string;
  permissions?: string[];
  preferredTeamId?: string;
  requireOwner?: boolean;
}

export interface AgentRouteDecision {
  selected?: FleetAgent;
  candidates: Array<{ id: string; teamId: string; score: number; reasons: string[] }>;
  rejected: Array<{ id: string; teamId: string; reasons: string[] }>;
}

export function buildAgentFleet(graph: OrgGraph): AgentFleet {
  const agents: FleetAgent[] = [];
  const providers: Record<string, number> = {};

  for (const teamId of [...graph.teams.keys()].sort()) {
    const team = graph.teams.get(teamId)!;
    const members = new Set(team.doc.members.map((member) => member.id));
    for (const agent of [...team.doc.agents].sort((a, b) => a.id.localeCompare(b.id))) {
      agents.push({
        id: `${teamId}/${agent.id}`,
        teamId,
        agent,
        ownerResolved: Boolean(agent.ownerId && members.has(agent.ownerId)),
        supervision: team.doc.cognitiveLoad?.supervision,
      });
      providers[agent.provider] = (providers[agent.provider] ?? 0) + 1;
    }
  }

  return {
    agents,
    summary: {
      total: agents.length,
      active: agents.filter((entry) => entry.agent.status === "active").length,
      unowned: agents.filter((entry) => !entry.ownerResolved).length,
      unscoredSupervision: agents.filter((entry) => entry.agent.status === "active" && entry.supervision === undefined)
        .length,
      providers: Object.fromEntries(Object.entries(providers).sort(([a], [b]) => a.localeCompare(b))),
    },
  };
}

/** Deterministically selects the safest capable agent; it never invokes the agent. */
export function routeAgentTask(graph: OrgGraph, request: AgentRouteRequest): AgentRouteDecision {
  const fleet = buildAgentFleet(graph);
  const candidates: AgentRouteDecision["candidates"] = [];
  const rejected: AgentRouteDecision["rejected"] = [];

  for (const entry of fleet.agents) {
    const reasons: string[] = [];
    if (entry.agent.status !== "active") reasons.push(`status is ${entry.agent.status}`);
    if (!entry.agent.capabilities.includes(request.capability))
      reasons.push(`lacks capability '${request.capability}'`);
    const missingPermissions = (request.permissions ?? []).filter(
      (permission) => !entry.agent.permissions.includes(permission),
    );
    if (missingPermissions.length > 0) reasons.push(`lacks permissions: ${missingPermissions.join(", ")}`);
    if ((request.requireOwner ?? true) && !entry.ownerResolved) reasons.push("has no resolvable human owner");

    if (reasons.length > 0) {
      rejected.push({ id: entry.id, teamId: entry.teamId, reasons });
      continue;
    }

    const score =
      100 +
      (entry.teamId === request.preferredTeamId ? 20 : 0) +
      Math.max(0, 10 - (entry.supervision ?? 10)) +
      entry.agent.permissions.length;
    candidates.push({
      id: entry.id,
      teamId: entry.teamId,
      score,
      reasons: [
        `declares capability '${request.capability}'`,
        ...(entry.teamId === request.preferredTeamId ? ["belongs to the preferred team"] : []),
        `human owner '${entry.agent.ownerId}' is resolvable`,
      ],
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  rejected.sort((a, b) => a.id.localeCompare(b.id));
  const selected = candidates.length > 0 ? fleet.agents.find((entry) => entry.id === candidates[0]!.id) : undefined;
  return { selected, candidates, rejected };
}
