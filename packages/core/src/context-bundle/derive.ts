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
import { getTeam, listMembers, listServices, type MemberEntry, type ServiceEntry } from "../model/queries";
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
  /**
   * Optional relevance signal layered on top of keyword overlap — in practice, embeddings.
   *
   * Injected rather than built in, so this function stays synchronous and pure: embedding is I/O,
   * and every existing caller (the MCP tool, `POST /context`) would otherwise have to become async
   * to gain a feature it may not have a model configured for. `createEmbeddingScorer` builds one.
   */
  scorer?: ContextBundleScorer;
}

/** Turns a candidate's text into an additional relevance score. Synchronous by construction: any
 * I/O has to happen before ranking starts, which is what `createEmbeddingScorer` does. */
export interface ContextBundleScorer {
  score(text: string): number;
}

export interface ScoredEntry<T> {
  teamId: TeamId;
  score: number;
  matchedTerms: string[];
  item: T;
}

/**
 * Two teams whose knowledge this goal draws on at once.
 *
 * A context bundle otherwise reads as if the goal belongs to whichever team was scoped. But the
 * entries that scored highest routinely span teams, and that is where the risk is: the work is
 * about to cross a boundary. Naming the seam — and how the two sides declared their relationship,
 * or that they declared nothing — tells an assistant who else has a stake before it starts, rather
 * than after someone notices.
 */
export interface SeamEntry {
  teams: [TeamId, TeamId];
  /** The Team Topologies interaction mode declared between them, if either declared one. */
  mode?: string;
  /** True when neither team declares any edge to the other. The goal spans a boundary nobody has
   * written down, which is worth more caution than a declared one, not less. */
  undeclared: boolean;
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
  /** Boundaries this goal's matched entries straddle. Empty when everything came from one team. */
  seams: SeamEntry[];
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

function scoreText(
  fields: Array<string | undefined>,
  tags: readonly string[],
  goalTokens: string[],
): { score: number; matchedTerms: string[] } {
  const haystack = [...fields, ...tags].filter(Boolean).join(" ").toLowerCase();
  const matchedTerms = goalTokens.filter((token) => haystack.includes(token));
  return { score: matchedTerms.length, matchedTerms };
}

/** The text a scorer sees for a candidate — the same fields keyword overlap reads, joined, so the
 * two signals are scored against identical material. */
export function candidateText(fields: Array<string | undefined>, tags: readonly string[]): string {
  return [...fields, ...tags].filter(Boolean).join(" ");
}

function rank<T extends { tags?: readonly string[] }>(
  entries: ResourceEntry<T>[],
  textFields: (item: T) => Array<string | undefined>,
  goalTokens: string[],
  teamId: TeamId | undefined,
  limit: number,
  scorer: ContextBundleScorer | undefined,
): ScoredEntry<T>[] {
  return (
    entries
      .map((entry) => {
        const tags = entry.item.tags ?? [];
        const { score, matchedTerms } = scoreText(textFields(entry.item), tags, goalTokens);
        const semantic = scorer ? scorer.score(candidateText(textFields(entry.item), tags)) : 0;
        const boosted = (teamId && entry.teamId === teamId ? score + SAME_TEAM_BOOST : score) + semantic;
        return { teamId: entry.teamId, item: entry.item, score: boosted, matchedTerms };
      })
      // A candidate the scorer alone surfaced is kept: that is the entire point of a semantic
      // signal — the goal shares no words with the document that answers it.
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  );
}

/** Each category's candidates and the fields that describe them, in one place so the embedding
 * scorer embeds exactly the text `rank` will later score. Two lists that drifted apart would look
 * like a mysteriously bad ranking rather than like a bug. */
export function contextBundleCandidateTexts(graph: OrgGraph, teamId?: TeamId): string[] {
  const steeringEntries: ResourceEntry<SteeringDocument>[] = teamId
    ? resolveEffectiveSteering(graph, teamId).map((item) => ({ teamId, item }))
    : listAllSteeringAcrossOrg(graph);

  const collect = <T extends { tags?: readonly string[] }>(
    entries: ResourceEntry<T>[],
    textFields: (item: T) => Array<string | undefined>,
  ): string[] => entries.map((entry) => candidateText(textFields(entry.item), entry.item.tags ?? []));

  return [
    ...collect(listAllSpecifications(graph), (s) => [s.title, s.body]),
    ...collect(steeringEntries, (d) => [d.title, d.body]),
    ...collect(listAllPolicies(graph), (p) => [p.name, p.description]),
    ...collect(searchMemory(graph), (m) => [m.title, m.body]),
    ...collect(searchKnowledgeBase(graph), (k) => [k.title, k.body, k.category]),
    ...collect(listAllPrompts(graph), (p) => [p.name, p.description, p.template]),
    ...collect(listAllPlaybooks(graph), (p) => [p.name, p.documentation]),
  ];
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
 * Relevance is a keyword-overlap score between `goal`'s tokens and each candidate resource's text
 * fields/tags, boosted for resources belonging to `teamId` when scoped. Keyword overlap needs no
 * external model and is transparent about *why* something was included (`matchedTerms`), which is
 * why it remains the default.
 *
 * `request.scorer` layers a second signal on top — `createEmbeddingScorer` builds one from
 * embeddings — and is what surfaces the document that answers the goal while sharing none of its
 * words. Additive rather than a replacement, so `matchedTerms` still says what it always said and
 * a bundle stays explicable.
 */
export function deriveContextBundle(graph: OrgGraph, request: ContextBundleRequest): ContextBundle {
  const goalTokens = tokenize(request.goal);
  const limit = request.limit ?? DEFAULT_LIMIT;
  const teamId = request.teamId;
  const scorer = request.scorer;

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

  const bundle: Omit<ContextBundle, "seams"> = {
    goal: request.goal,
    teamId,
    team: team ? toTeamSummaryDto(team) : undefined,
    relatedTeams,
    specifications: rank(listAllSpecifications(graph), (s) => [s.title, s.body], goalTokens, teamId, limit, scorer),
    steeringDocuments: rank(steeringEntries, (d) => [d.title, d.body], goalTokens, teamId, limit, scorer),
    policies: rank(listAllPolicies(graph), (p) => [p.name, p.description], goalTokens, teamId, limit, scorer),
    memory: rank(searchMemory(graph), (m) => [m.title, m.body], goalTokens, teamId, limit, scorer),
    knowledgeBase: rank(
      searchKnowledgeBase(graph),
      (k) => [k.title, k.body, k.category],
      goalTokens,
      teamId,
      limit,
      scorer,
    ),
    prompts: rank(listAllPrompts(graph), (p) => [p.name, p.description, p.template], goalTokens, teamId, limit, scorer),
    playbooks: rank(listAllPlaybooks(graph), (p) => [p.name, p.documentation], goalTokens, teamId, limit, scorer),
    services: teamId ? listServices(graph).filter((s) => s.teamId === teamId) : [],
    members: teamId ? listMembers(graph, teamId) : [],
  };

  return { ...bundle, seams: deriveSeams(graph, bundle) };
}

/**
 * Every pair of teams the ranked entries touch, with the relationship the graph declares between
 * them. Derived from data the bundle already computed — each `ScoredEntry` carries its `teamId` —
 * so this costs one pass over the results and no extra lookups.
 */
function deriveSeams(graph: OrgGraph, bundle: Omit<ContextBundle, "seams">): SeamEntry[] {
  const contributing = [
    ...bundle.specifications,
    ...bundle.steeringDocuments,
    ...bundle.policies,
    ...bundle.memory,
    ...bundle.knowledgeBase,
    ...bundle.prompts,
    ...bundle.playbooks,
  ].map((entry) => entry.teamId);

  const teams = [...new Set(contributing)].sort();
  if (teams.length < 2) return [];

  const seams: SeamEntry[] = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const [a, b] = [teams[i]!, teams[j]!];
      const between = graph.edges.filter(
        (edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a),
      );
      const interaction = between.find((edge) => edge.kind === "interaction");
      seams.push({
        teams: [a, b],
        mode: interaction?.kind === "interaction" ? interaction.mode : undefined,
        undeclared: between.length === 0,
      });
    }
  }
  return seams;
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
