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

/** Interactions default to `"both"` directions: Team Topologies interactions (collaboration /
 * x-as-a-service / facilitating) are inherently mutual relationships, so "both" is the more
 * useful default view. Contrast with `getDependencies`, which defaults to `"out"` only. */
export function getInteractions(
  graph: OrgGraph,
  id: TeamId,
  direction: "in" | "out" | "both" = "both",
): InteractionEdge[] {
  return graph.edges
    .filter((e): e is InteractionEdge => e.kind === "interaction")
    .filter((e) => matchesDirection(e, id, direction));
}

/** Dependencies default to `"out"` only (what this team depends on), not `"both"`: a dependency
 * is directional by nature (Team A depends on Team B is a different statement from the reverse),
 * so "what do I depend on" is the more useful default view. Pass `direction: "in"` to see who
 * depends on this team instead, or `"both"` for every dependency edge touching it. */
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

/**
 * Finds the team declaring a service with this exact (case-insensitive) name. Service names are
 * expected to be unique org-wide, but that isn't enforced by the schema — if two teams declare
 * the same service name, the team whose id sorts first alphabetically wins, which is at least a
 * deterministic, well-defined tie-break rather than an accident of graph traversal order.
 */
export function findServiceOwner(graph: OrgGraph, serviceName: string): ServiceEntry | undefined {
  const q = serviceName.toLowerCase();
  const teams = [...graph.teams.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const team of teams) {
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

export type SearchResultKind =
  | "team"
  | "service"
  | "role"
  | "member"
  | "searchTerm"
  | "agent"
  | "memory"
  | "specification"
  | "steeringDocument"
  | "prompt"
  | "playbook"
  | "policy"
  | "knowledgeBase"
  | "workflow"
  | "session";

export interface SearchResult {
  kind: SearchResultKind;
  teamId: TeamId;
  /** The matched resource's id within its team array, for kinds other than "team" (which is
   * already identified by `teamId`) — lets a caller fetch the full resource via the matching
   * `get*` query without re-searching. */
  resourceId?: string;
  label: string;
}

/**
 * Unified search across every resource kind: teams, services, roles, members, search terms, and
 * every AI-native domain (agents, memory, specifications, steering documents, prompts, playbooks,
 * policies, knowledge base, workflows, sessions). A simple case-insensitive substring match, same
 * as the original team/service/role/member search — deliberately not semantic/embedding-based (a
 * heuristic v1; nothing here stops a future `search` implementation from swapping in a real
 * scorer, same spirit as `deriveContextBundle`'s relevance scoring).
 */
export function searchOrg(graph: OrgGraph, query: string): SearchResult[] {
  const q = query.toLowerCase();
  const includes = (text: string | undefined) => (text ?? "").toLowerCase().includes(q);
  const results: SearchResult[] = [];
  for (const team of graph.teams.values()) {
    if (includes(team.doc.info.name) || includes(team.doc.info.focus)) {
      results.push({ kind: "team", teamId: team.id, label: team.doc.info.name });
    }
    for (const service of team.doc.services) {
      if (includes(service.name)) {
        results.push({ kind: "service", teamId: team.id, label: service.name });
      }
    }
    for (const role of team.doc.roles) {
      if (includes(role.name) || includes(role.kind)) {
        results.push({ kind: "role", teamId: team.id, resourceId: role.id, label: `${role.name} (${role.kind})` });
      }
    }
    for (const member of team.doc.members) {
      if (includes(member.name)) {
        results.push({ kind: "member", teamId: team.id, resourceId: member.id, label: member.name });
      }
    }
    for (const term of team.doc.searchTerms) {
      if (includes(term.term)) {
        results.push({ kind: "searchTerm", teamId: team.id, label: term.term });
      }
    }
    for (const agent of team.doc.agents) {
      if (includes(agent.name) || includes(agent.role) || includes(agent.description) || agent.tags.some(includes)) {
        results.push({ kind: "agent", teamId: team.id, resourceId: agent.id, label: agent.name });
      }
    }
    for (const entry of team.doc.memory) {
      if (includes(entry.title) || includes(entry.body) || entry.tags.some(includes)) {
        results.push({ kind: "memory", teamId: team.id, resourceId: entry.id, label: entry.title });
      }
    }
    for (const spec of team.doc.specifications) {
      if (includes(spec.title) || includes(spec.body) || spec.tags.some(includes)) {
        results.push({ kind: "specification", teamId: team.id, resourceId: spec.id, label: spec.title });
      }
    }
    for (const doc of team.doc.steeringDocuments) {
      if (includes(doc.title) || includes(doc.body) || doc.tags.some(includes)) {
        results.push({ kind: "steeringDocument", teamId: team.id, resourceId: doc.id, label: doc.title });
      }
    }
    for (const prompt of team.doc.prompts) {
      if (includes(prompt.name) || includes(prompt.description) || includes(prompt.template) || prompt.tags.some(includes)) {
        results.push({ kind: "prompt", teamId: team.id, resourceId: prompt.id, label: prompt.name });
      }
    }
    for (const playbook of team.doc.playbooks) {
      if (includes(playbook.name) || includes(playbook.documentation) || playbook.tags.some(includes)) {
        results.push({ kind: "playbook", teamId: team.id, resourceId: playbook.id, label: playbook.name });
      }
    }
    for (const policy of team.doc.policies) {
      if (includes(policy.name) || includes(policy.description) || policy.tags.some(includes)) {
        results.push({ kind: "policy", teamId: team.id, resourceId: policy.id, label: policy.name });
      }
    }
    for (const entry of team.doc.knowledgeBase) {
      if (includes(entry.title) || includes(entry.body) || includes(entry.category) || entry.tags.some(includes)) {
        results.push({ kind: "knowledgeBase", teamId: team.id, resourceId: entry.id, label: entry.title });
      }
    }
    for (const workflow of team.doc.workflows) {
      if (includes(workflow.name) || includes(workflow.description) || workflow.tags.some(includes)) {
        results.push({ kind: "workflow", teamId: team.id, resourceId: workflow.id, label: workflow.name });
      }
    }
    for (const session of team.doc.sessions) {
      if (includes(session.objective) || includes(session.assistant) || session.tags.some(includes)) {
        results.push({ kind: "session", teamId: team.id, resourceId: session.id, label: session.objective });
      }
    }
  }
  return results;
}
