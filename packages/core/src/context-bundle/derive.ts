import type {
  KnowledgeBaseEntry,
  MemoryEntry,
  Playbook,
  Policy,
  Prompt,
  SteeringDocument,
  Specification,
} from "@jgalego/teamapi-schema";
import type { OrgGraph, TeamId } from "../model/org-graph";
import {
  getTeam,
  listMembers,
  listServices,
  type MemberEntry,
  type ServiceEntry,
} from "../model/queries";
import {
  listAllPlaybooks,
  listAllPolicies,
  listAllPrompts,
  listAllSpecifications,
  resolveEffectiveSteering,
  searchKnowledgeBase,
  searchMemory,
  type ResourceEntry,
} from "../model/knowledge-resources";
import { toTeamSummaryDto, type TeamSummaryDto } from "../serialize/team-dto";

export interface ContextBundleRequest {
  /** What the requester (typically an AI assistant) is trying to accomplish, e.g. "Implement OAuth". */
  goal: string;
  /** Scopes the bundle to one team: its own resources are boosted in relevance ranking, and its
   * direct team-graph neighbors are surfaced as `relatedTeams`. Omit for an org-wide bundle. */
  teamId?: TeamId;
  /** Max items returned per resource category. Defaults to 5. */
  limit?: number;
}

export interface ScoredEntry<T> {
  teamId: TeamId;
  score: number;
  matchedTerms: string[];
  item: T;
}

export interface ContextBundle {
  goal: string;
  teamId?: TeamId;
  team?: TeamSummaryDto;
  /** Teams directly connected to `teamId` via platform/interaction/dependency edges — the people
   * likely worth looping in for `goal`. Empty when `teamId` is omitted. */
  relatedTeams: TeamSummaryDto[];
  specifications: ScoredEntry<Specification>[];
  steeringDocuments: ScoredEntry<SteeringDocument>[];
  policies: ScoredEntry<Policy>[];
  memory: ScoredEntry<MemoryEntry>[];
  knowledgeBase: ScoredEntry<KnowledgeBaseEntry>[];
  prompts: ScoredEntry<Prompt>[];
  playbooks: ScoredEntry<Playbook>[];
  services: ServiceEntry[];
  members: MemberEntry[];
}

const DEFAULT_LIMIT = 5;
/** A resource belonging to the scoped team ranks as if it matched this many extra goal terms —
 * enough to usually outrank an equally-relevant org-wide resource, without burying a highly
 * relevant resource from elsewhere behind a barely-relevant one from the scoped team. */
const SAME_TEAM_BOOST = 2;

function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  return [...new Set(tokens)];
}

function scoreText(fields: Array<string | undefined>, tags: readonly string[], goalTokens: string[]): { score: number; matchedTerms: string[] } {
  const haystack = [...fields, ...tags].filter(Boolean).join(" ").toLowerCase();
  const matchedTerms = goalTokens.filter((token) => haystack.includes(token));
  return { score: matchedTerms.length, matchedTerms };
}

function rank<T extends { tags?: readonly string[] }>(
  entries: ResourceEntry<T>[],
  textFields: (item: T) => Array<string | undefined>,
  goalTokens: string[],
  teamId: TeamId | undefined,
  limit: number,
): ScoredEntry<T>[] {
  return entries
    .map((entry) => {
      const { score, matchedTerms } = scoreText(textFields(entry.item), entry.item.tags ?? [], goalTokens);
      const boosted = teamId && entry.teamId === teamId ? score + SAME_TEAM_BOOST : score;
      return { teamId: entry.teamId, item: entry.item, score: boosted, matchedTerms };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function relatedTeamIds(graph: OrgGraph, teamId: TeamId): TeamId[] {
  const ids = new Set<TeamId>();
  for (const edge of graph.edges) {
    if (edge.kind === "platform" || edge.kind === "interaction" || edge.kind === "dependency") {
      if (edge.from === teamId) ids.add(edge.to);
      if (edge.to === teamId) ids.add(edge.from);
    }
  }
  ids.delete(teamId);
  return [...ids];
}

/**
 * Assembles a "context bundle": the minimum high-quality set of specifications, steering
 * documents, policies, memory, knowledge base entries, prompts, playbooks, services, and people
 * relevant to a stated `goal`, so an AI assistant doesn't have to fetch (or worse, guess at) the
 * whole org graph to get oriented.
 *
 * Relevance is a heuristic keyword-overlap score between `goal`'s tokens and each candidate
 * resource's text fields/tags, boosted for resources belonging to `teamId` when scoped. This is a
 * v1 scorer, not semantic search — nothing here stops swapping in embeddings-based ranking later
 * (see `docs/spec/teamapi-extended-v1.md`'s roadmap notes), but keyword overlap requires no
 * external model dependency and is transparent about *why* something was included (`matchedTerms`).
 */
export function deriveContextBundle(graph: OrgGraph, request: ContextBundleRequest): ContextBundle {
  const goalTokens = tokenize(request.goal);
  const limit = request.limit ?? DEFAULT_LIMIT;
  const teamId = request.teamId;

  const team = teamId ? getTeam(graph, teamId) : undefined;
  const relatedTeams = teamId
    ? relatedTeamIds(graph, teamId)
        .map((id) => getTeam(graph, id))
        .filter((t): t is NonNullable<typeof t> => !!t)
        .map(toTeamSummaryDto)
    : [];

  const steeringEntries: ResourceEntry<SteeringDocument>[] = teamId
    ? resolveEffectiveSteering(graph, teamId).map((item) => ({ teamId, item }))
    : listAllSteeringAcrossOrg(graph);

  return {
    goal: request.goal,
    teamId,
    team: team ? toTeamSummaryDto(team) : undefined,
    relatedTeams,
    specifications: rank(listAllSpecifications(graph), (s) => [s.title, s.body], goalTokens, teamId, limit),
    steeringDocuments: rank(steeringEntries, (d) => [d.title, d.body], goalTokens, teamId, limit),
    policies: rank(listAllPolicies(graph), (p) => [p.name, p.description], goalTokens, teamId, limit),
    memory: rank(searchMemory(graph), (m) => [m.title, m.body], goalTokens, teamId, limit),
    knowledgeBase: rank(searchKnowledgeBase(graph), (k) => [k.title, k.body, k.category], goalTokens, teamId, limit),
    prompts: rank(listAllPrompts(graph), (p) => [p.name, p.description, p.template], goalTokens, teamId, limit),
    playbooks: rank(listAllPlaybooks(graph), (p) => [p.name, p.documentation], goalTokens, teamId, limit),
    services: teamId ? listServices(graph).filter((s) => s.teamId === teamId) : [],
    members: teamId ? listMembers(graph, teamId) : [],
  };
}

function listAllSteeringAcrossOrg(graph: OrgGraph): ResourceEntry<SteeringDocument>[] {
  const results: ResourceEntry<SteeringDocument>[] = [];
  for (const teamId of graph.teams.keys()) {
    for (const item of resolveEffectiveSteering(graph, teamId)) {
      results.push({ teamId, item });
    }
  }
  return results;
}
