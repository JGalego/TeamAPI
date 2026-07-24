import type {
  Agent,
  AiSession,
  KnowledgeBaseEntry,
  MemoryEntry,
  Playbook,
  Policy,
  Prompt,
  SteeringDocument,
  Specification,
  TeamApiDocument,
  Workflow,
} from "@jgalego/teamapi-schema";
import type { OrgGraph, TeamId } from "./org-graph";

/**
 * One of the AI-native resource arrays declared on a `TeamApiDocument`, every one of which is a
 * `{ id: string, ... }[]` — the shape this module's generic helpers operate on. Listed explicitly
 * (rather than derived via a mapped type over `keyof TeamApiDocument`) because that schema's
 * `.passthrough()` gives its inferred type a `[k: string]: unknown` index signature, which
 * collapses `keyof` down to plain `string` and defeats a mapped-type approach.
 */
type ResourceArrayKey =
  | "agents"
  | "memory"
  | "specifications"
  | "steeringDocuments"
  | "prompts"
  | "playbooks"
  | "policies"
  | "knowledgeBase"
  | "workflows"
  | "sessions";

export interface ResourceEntry<T> {
  teamId: TeamId;
  item: T;
}

function listInTeam<T extends { id: string }>(team: { doc: TeamApiDocument } | undefined, key: ResourceArrayKey): T[] {
  if (!team) return [];
  const items = team.doc[key] as unknown as T[];
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function listAcrossOrg<T extends { id: string }>(graph: OrgGraph, key: ResourceArrayKey): ResourceEntry<T>[] {
  const results: ResourceEntry<T>[] = [];
  for (const team of graph.teams.values()) {
    for (const item of listInTeam<T>(team, key)) {
      results.push({ teamId: team.id, item });
    }
  }
  return results.sort((a, b) => a.item.id.localeCompare(b.item.id) || a.teamId.localeCompare(b.teamId));
}

/** Case-insensitive substring match over a resource's searchable text fields plus its tags. */
function matchesSearch(fields: Array<string | undefined>, tags: readonly string[] | undefined, search: string): boolean {
  const q = search.toLowerCase();
  if (fields.some((f) => f?.toLowerCase().includes(q))) return true;
  return (tags ?? []).some((t) => t.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------------------------

export function listAgents(graph: OrgGraph, teamId: TeamId): Agent[] {
  return listInTeam<Agent>(graph.teams.get(teamId), "agents");
}

export function getAgent(graph: OrgGraph, teamId: TeamId, agentId: string): Agent | undefined {
  return listAgents(graph, teamId).find((a) => a.id === agentId);
}

export function listAllAgents(graph: OrgGraph, search?: string): ResourceEntry<Agent>[] {
  let results = listAcrossOrg<Agent>(graph, "agents");
  if (search) results = results.filter((r) => matchesSearch([r.item.name, r.item.role, r.item.description], r.item.tags, search));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

export function listMemory(graph: OrgGraph, teamId: TeamId): MemoryEntry[] {
  return listInTeam<MemoryEntry>(graph.teams.get(teamId), "memory");
}

export function getMemoryEntry(graph: OrgGraph, teamId: TeamId, entryId: string): MemoryEntry | undefined {
  return listMemory(graph, teamId).find((m) => m.id === entryId);
}

export function searchMemory(graph: OrgGraph, search?: string): ResourceEntry<MemoryEntry>[] {
  let results = listAcrossOrg<MemoryEntry>(graph, "memory");
  if (search) results = results.filter((r) => matchesSearch([r.item.title, r.item.body], r.item.tags, search));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Specifications
// ---------------------------------------------------------------------------------------------

export function listSpecifications(graph: OrgGraph, teamId: TeamId): Specification[] {
  return listInTeam<Specification>(graph.teams.get(teamId), "specifications");
}

export function getSpecification(graph: OrgGraph, teamId: TeamId, specId: string): Specification | undefined {
  return listSpecifications(graph, teamId).find((s) => s.id === specId);
}

export function listAllSpecifications(graph: OrgGraph, search?: string): ResourceEntry<Specification>[] {
  let results = listAcrossOrg<Specification>(graph, "specifications");
  if (search) results = results.filter((r) => matchesSearch([r.item.title, r.item.body], r.item.tags, search));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Steering documents
// ---------------------------------------------------------------------------------------------

export function listSteeringDocuments(graph: OrgGraph, teamId: TeamId): SteeringDocument[] {
  return listInTeam<SteeringDocument>(graph.teams.get(teamId), "steeringDocuments");
}

export function getSteeringDocument(graph: OrgGraph, teamId: TeamId, docId: string): SteeringDocument | undefined {
  return listSteeringDocuments(graph, teamId).find((d) => d.id === docId);
}

/**
 * Resolves the *effective* steering documents for a team: its own `steeringDocuments[]`, plus
 * every `organization`/`team`-scoped document declared on the team(s) reachable by walking the
 * existing `platform` edge upward (this team -> its platform team -> that team's platform team,
 * etc.) — reusing the graph's platform-hierarchy edge rather than inventing a second inheritance
 * mechanism. Nearer documents win: if an inherited document shares an `id` with one the team
 * declares itself, the team's own copy is kept and the inherited one is dropped.
 */
export function resolveEffectiveSteering(graph: OrgGraph, teamId: TeamId): SteeringDocument[] {
  const ownDocs = listSteeringDocuments(graph, teamId);
  const seenIds = new Set(ownDocs.map((d) => d.id));
  const inherited: SteeringDocument[] = [];

  const visited = new Set<TeamId>([teamId]);
  let current = teamId;
  for (let hops = 0; hops < graph.teams.size; hops++) {
    const platformEdge = graph.edges.find((e) => e.kind === "platform" && e.from === current);
    if (!platformEdge) break;
    const next = platformEdge.to;
    if (visited.has(next)) break; // guards against a (malformed) platform-reference cycle
    visited.add(next);

    for (const doc of listSteeringDocuments(graph, next)) {
      if (seenIds.has(doc.id)) continue;
      seenIds.add(doc.id);
      inherited.push(doc);
    }
    current = next;
  }

  return [...ownDocs, ...inherited].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------------------------

export function listPrompts(graph: OrgGraph, teamId: TeamId): Prompt[] {
  return listInTeam<Prompt>(graph.teams.get(teamId), "prompts");
}

export function getPrompt(graph: OrgGraph, teamId: TeamId, promptId: string): Prompt | undefined {
  return listPrompts(graph, teamId).find((p) => p.id === promptId);
}

export function listAllPrompts(graph: OrgGraph, search?: string): ResourceEntry<Prompt>[] {
  let results = listAcrossOrg<Prompt>(graph, "prompts");
  if (search) results = results.filter((r) => matchesSearch([r.item.name, r.item.description, r.item.template], r.item.tags, search));
  return results;
}

export class MissingPromptVariableError extends Error {
  constructor(readonly variable: string) {
    super(`Missing required prompt variable '${variable}'`);
  }
}

/**
 * Fills a prompt's `{{variable}}` placeholders from `variables`, falling back to each
 * `PromptVariable.default` when a value isn't supplied. Throws `MissingPromptVariableError` for
 * any variable marked `required` that ends up with neither a supplied value nor a default —
 * better to fail loudly than hand an AI assistant a prompt with a placeholder still in it.
 */
export function renderPrompt(prompt: Prompt, variables: Record<string, string> = {}): string {
  let rendered = prompt.template;
  for (const variable of prompt.variables) {
    const value = variables[variable.name] ?? variable.default;
    if (value === undefined) {
      if (variable.required) throw new MissingPromptVariableError(variable.name);
      continue;
    }
    rendered = rendered.split(`{{${variable.name}}}`).join(value);
  }
  return rendered;
}

// ---------------------------------------------------------------------------------------------
// Playbooks
// ---------------------------------------------------------------------------------------------

export function listPlaybooks(graph: OrgGraph, teamId: TeamId): Playbook[] {
  return listInTeam<Playbook>(graph.teams.get(teamId), "playbooks");
}

export function getPlaybook(graph: OrgGraph, teamId: TeamId, playbookId: string): Playbook | undefined {
  return listPlaybooks(graph, teamId).find((p) => p.id === playbookId);
}

export function listAllPlaybooks(graph: OrgGraph, search?: string): ResourceEntry<Playbook>[] {
  let results = listAcrossOrg<Playbook>(graph, "playbooks");
  if (search) results = results.filter((r) => matchesSearch([r.item.name, r.item.documentation], r.item.tags, search));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------------------------

export function listPolicies(graph: OrgGraph, teamId: TeamId): Policy[] {
  return listInTeam<Policy>(graph.teams.get(teamId), "policies");
}

export function getPolicy(graph: OrgGraph, teamId: TeamId, policyId: string): Policy | undefined {
  return listPolicies(graph, teamId).find((p) => p.id === policyId);
}

export function listAllPolicies(graph: OrgGraph, search?: string): ResourceEntry<Policy>[] {
  let results = listAcrossOrg<Policy>(graph, "policies");
  if (search) results = results.filter((r) => matchesSearch([r.item.name, r.item.description], r.item.tags, search));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Knowledge base
// ---------------------------------------------------------------------------------------------

export function listKnowledgeBase(graph: OrgGraph, teamId: TeamId): KnowledgeBaseEntry[] {
  return listInTeam<KnowledgeBaseEntry>(graph.teams.get(teamId), "knowledgeBase");
}

export function getKnowledgeBaseEntry(graph: OrgGraph, teamId: TeamId, entryId: string): KnowledgeBaseEntry | undefined {
  return listKnowledgeBase(graph, teamId).find((e) => e.id === entryId);
}

export function searchKnowledgeBase(graph: OrgGraph, search?: string): ResourceEntry<KnowledgeBaseEntry>[] {
  let results = listAcrossOrg<KnowledgeBaseEntry>(graph, "knowledgeBase");
  if (search) results = results.filter((r) => matchesSearch([r.item.title, r.item.body, r.item.category], r.item.tags, search));
  return results;
}

// ---------------------------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------------------------

export function listWorkflows(graph: OrgGraph, teamId: TeamId): Workflow[] {
  return listInTeam<Workflow>(graph.teams.get(teamId), "workflows");
}

export function getWorkflow(graph: OrgGraph, teamId: TeamId, workflowId: string): Workflow | undefined {
  return listWorkflows(graph, teamId).find((w) => w.id === workflowId);
}

export function listAllWorkflows(graph: OrgGraph, search?: string): ResourceEntry<Workflow>[] {
  let results = listAcrossOrg<Workflow>(graph, "workflows");
  if (search) results = results.filter((r) => matchesSearch([r.item.name, r.item.description], r.item.tags, search));
  return results;
}

// ---------------------------------------------------------------------------------------------
// AI sessions
// ---------------------------------------------------------------------------------------------

export function listSessions(graph: OrgGraph, teamId: TeamId): AiSession[] {
  return listInTeam<AiSession>(graph.teams.get(teamId), "sessions");
}

export function getSession(graph: OrgGraph, teamId: TeamId, sessionId: string): AiSession | undefined {
  return listSessions(graph, teamId).find((s) => s.id === sessionId);
}

export function listAllSessions(graph: OrgGraph, search?: string): ResourceEntry<AiSession>[] {
  let results = listAcrossOrg<AiSession>(graph, "sessions");
  if (search) results = results.filter((r) => matchesSearch([r.item.objective, r.item.assistant], r.item.tags, search));
  return results;
}
