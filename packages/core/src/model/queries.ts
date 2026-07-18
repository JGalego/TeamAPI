import type { Member, Service, Role } from "@jgalego/teamapi-schema";
import type { GraphEdge, OrgGraph, ResolvedTeam, TeamId } from "./org-graph";

export interface ListTeamsFilter {
  type?: string;
  search?: string;
}

export function listTeams(graph: OrgGraph, filter: ListTeamsFilter = {}): ResolvedTeam[] {
  let teams = [...graph.teams.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (filter.type) {
    teams = teams.filter((t) => t.doc.info.type === filter.type);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    teams = teams.filter(
      (t) => t.doc.info.name.toLowerCase().includes(q) || (t.doc.info.focus ?? "").toLowerCase().includes(q),
    );
  }
  return teams;
}

export function getTeam(graph: OrgGraph, id: TeamId): ResolvedTeam | undefined {
  return graph.teams.get(id);
}

type InteractionEdge = Extract<GraphEdge, { kind: "interaction" }>;
type DependencyEdge = Extract<GraphEdge, { kind: "dependency" }>;

export function getInteractions(
  graph: OrgGraph,
  id: TeamId,
  direction: "in" | "out" | "both" = "both",
): InteractionEdge[] {
  return graph.edges
    .filter((e): e is InteractionEdge => e.kind === "interaction")
    .filter((e) => matchesDirection(e, id, direction));
}

export function getDependencies(
  graph: OrgGraph,
  id: TeamId,
  direction: "in" | "out" | "both" = "out",
): DependencyEdge[] {
  return graph.edges
    .filter((e): e is DependencyEdge => e.kind === "dependency")
    .filter((e) => matchesDirection(e, id, direction));
}

function matchesDirection(e: { from: TeamId; to: TeamId }, id: TeamId, direction: "in" | "out" | "both"): boolean {
  if (direction === "in") return e.to === id;
  if (direction === "out") return e.from === id;
  return e.from === id || e.to === id;
}

export interface ServiceEntry {
  teamId: TeamId;
  service: Service;
}

export function listServices(graph: OrgGraph, search?: string): ServiceEntry[] {
  const results: ServiceEntry[] = [];
  for (const team of graph.teams.values()) {
    for (const service of team.doc.services) {
      if (!search || service.name.toLowerCase().includes(search.toLowerCase())) {
        results.push({ teamId: team.id, service });
      }
    }
  }
  return results.sort((a, b) => a.service.name.localeCompare(b.service.name));
}

export function findServiceOwner(graph: OrgGraph, serviceName: string): ServiceEntry | undefined {
  const q = serviceName.toLowerCase();
  for (const team of graph.teams.values()) {
    const service = team.doc.services.find((s) => s.name.toLowerCase() === q);
    if (service) return { teamId: team.id, service };
  }
  return undefined;
}

export interface RoleEntry {
  teamId: TeamId;
  role: Role;
}

export function listRoles(graph: OrgGraph, teamId: TeamId): RoleEntry[] {
  const team = graph.teams.get(teamId);
  if (!team) return [];
  return [...team.doc.roles].sort((a, b) => a.id.localeCompare(b.id)).map((role) => ({ teamId, role }));
}

export interface MemberEntry {
  teamId: TeamId;
  member: Member;
}

export function listMembers(graph: OrgGraph, teamId: TeamId): MemberEntry[] {
  const team = graph.teams.get(teamId);
  if (!team) return [];
  return [...team.doc.members].sort((a, b) => a.id.localeCompare(b.id)).map((member) => ({ teamId, member }));
}

export interface SearchResult {
  kind: "team" | "service" | "role" | "member" | "searchTerm";
  teamId: TeamId;
  label: string;
}

export function searchOrg(graph: OrgGraph, query: string): SearchResult[] {
  const q = query.toLowerCase();
  const results: SearchResult[] = [];
  for (const team of graph.teams.values()) {
    if (team.doc.info.name.toLowerCase().includes(q) || (team.doc.info.focus ?? "").toLowerCase().includes(q)) {
      results.push({ kind: "team", teamId: team.id, label: team.doc.info.name });
    }
    for (const service of team.doc.services) {
      if (service.name.toLowerCase().includes(q)) {
        results.push({ kind: "service", teamId: team.id, label: service.name });
      }
    }
    for (const role of team.doc.roles) {
      if (role.name.toLowerCase().includes(q) || role.kind.toLowerCase().includes(q)) {
        results.push({ kind: "role", teamId: team.id, label: `${role.name} (${role.kind})` });
      }
    }
    for (const member of team.doc.members) {
      if (member.name.toLowerCase().includes(q)) {
        results.push({ kind: "member", teamId: team.id, label: member.name });
      }
    }
    for (const term of team.doc.searchTerms) {
      if (term.term.toLowerCase().includes(q)) {
        results.push({ kind: "searchTerm", teamId: team.id, label: term.term });
      }
    }
  }
  return results;
}
