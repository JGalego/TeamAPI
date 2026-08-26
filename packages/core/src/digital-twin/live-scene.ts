import type { TeamType } from "@jgalego/teamapi-schema";
import { scoreCognitiveLoad, type CognitiveLoadLabel } from "../cognitive-load/score";
import type { GraphEdge, OrgGraph } from "../model/org-graph";

export interface DigitalTwinTeam {
  id: string;
  name: string;
  type: TeamType;
  focus?: string;
  members: number;
  services: number;
  agents: number;
  cognitiveLoad?: CognitiveLoadLabel;
}

export interface DigitalTwinLink {
  id: string;
  from: string;
  to: string;
  kind: GraphEdge["kind"];
  label: string;
}

export interface DigitalTwinActor {
  id: string;
  teamId: string;
  name: string;
  kind: "human" | "agent";
  status: "active" | "inactive" | "deprecated";
  ownerId?: string;
}

export interface DigitalTwinEvent {
  id: string;
  kind: "interaction" | "dependency" | "platform" | "agent" | "service" | "heartbeat";
  teamId: string;
  targetTeamId?: string;
  actorId?: string;
  label: string;
}

export interface DigitalTwinScene {
  generatedAt: string;
  teams: DigitalTwinTeam[];
  links: DigitalTwinLink[];
  actors: DigitalTwinActor[];
  events: DigitalTwinEvent[];
}

function edgeLabel(edge: GraphEdge): string {
  if (edge.kind === "interaction") return edge.mode;
  if (edge.kind === "dependency") return edge.type;
  return "platform";
}

/**
 * Builds a deterministic replay scene from the declared organization graph.
 * Events are visualization cues, not claims that work is currently executing.
 */
export function buildDigitalTwinScene(graph: OrgGraph): DigitalTwinScene {
  const teams: DigitalTwinTeam[] = [];
  const actors: DigitalTwinActor[] = [];
  const events: DigitalTwinEvent[] = [];

  for (const teamId of [...graph.teams.keys()].sort()) {
    const document = graph.teams.get(teamId)!.doc;
    teams.push({
      id: teamId,
      name: document.info.name,
      type: document.info.type,
      focus: document.info.focus,
      members: document.members.length,
      services: document.services.length,
      agents: document.agents.length,
      cognitiveLoad: document.cognitiveLoad ? scoreCognitiveLoad(document.cognitiveLoad).label : undefined,
    });

    for (const member of [...document.members].sort((a, b) => a.id.localeCompare(b.id))) {
      actors.push({ id: `${teamId}/human/${member.id}`, teamId, name: member.name, kind: "human", status: "active" });
    }
    for (const agent of [...document.agents].sort((a, b) => a.id.localeCompare(b.id))) {
      const actorId = `${teamId}/agent/${agent.id}`;
      actors.push({
        id: actorId,
        teamId,
        name: agent.name,
        kind: "agent",
        status: agent.status,
        ownerId: agent.ownerId,
      });
      events.push({
        id: `agent:${teamId}:${agent.id}`,
        kind: "agent",
        teamId,
        actorId,
        label: `${agent.name} is ${agent.status}${agent.ownerId ? ` · owner ${agent.ownerId}` : " · owner unresolved"}`,
      });
    }
    for (const service of [...document.services].sort((a, b) => a.name.localeCompare(b.name))) {
      events.push({
        id: `service:${teamId}:${service.name}`,
        kind: "service",
        teamId,
        label: `${teamId} operates ${service.name}`,
      });
    }
  }

  const links = [...graph.edges]
    .sort((a, b) => `${a.from}:${a.to}:${a.kind}`.localeCompare(`${b.from}:${b.to}:${b.kind}`))
    .map((edge, index) => {
      const label = edgeLabel(edge);
      events.push({
        id: `edge:${index}:${edge.from}:${edge.to}`,
        kind: edge.kind,
        teamId: edge.from,
        targetTeamId: edge.to,
        label: `${edge.from} → ${edge.to} · ${label}`,
      });
      return { id: `link:${index}:${edge.from}:${edge.to}`, from: edge.from, to: edge.to, kind: edge.kind, label };
    });

  if (events.length === 0 && teams.length > 0) {
    events.push({ id: `heartbeat:${teams[0]!.id}`, kind: "heartbeat", teamId: teams[0]!.id, label: "Graph loaded" });
  }

  return {
    generatedAt: graph.meta.resolvedAt,
    teams,
    links,
    actors: actors.sort((a, b) => a.id.localeCompare(b.id)),
    events: events.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
