import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  deriveContextBundle,
  deriveKnowledgeGraph,
  getAgent,
  getKnowledgeBaseEntry,
  getMemoryEntry,
  getPlaybook,
  getPolicy,
  getPrompt,
  getSession,
  getSpecification,
  getSteeringDocument,
  getTeam,
  getWorkflow,
  listAgents,
  listAllAgents,
  listAllPlaybooks,
  listAllPolicies,
  listAllPrompts,
  listAllSessions,
  listAllSpecifications,
  listAllWorkflows,
  listKnowledgeBase,
  listMemory,
  listPlaybooks,
  listPolicies,
  listPrompts,
  listSessions,
  listSpecifications,
  listSteeringDocuments,
  listWorkflows,
  MissingPromptVariableError,
  renderPrompt,
  resolveEffectiveSteering,
  searchKnowledgeBase,
  searchMemory,
  traverseKnowledgeGraph,
  type OrgGraph,
  type OrgGraphStore,
  type ResourceEntry,
} from "@jgalego/teamapi-core";
import { errorResult, jsonResult } from "./result";
import { looseRegisterTool, type LooseRegisterTool } from "./loose-register";

interface ResourceToolOptions<T> {
  resourceName: string; // singular, e.g. "agent" -> get_agent
  pluralName: string; // e.g. "agents" -> list_agents
  description: string; // human-readable label, e.g. "agent"
  listInTeam: (graph: OrgGraph, teamId: string) => T[];
  getById: (graph: OrgGraph, teamId: string, resourceId: string) => T | undefined;
  listAcrossOrg: (graph: OrgGraph, search?: string) => ResourceEntry<T>[];
}

/** Registers the `list_<plural>`/`get_<singular>` MCP tool pair shared by every AI-native
 * resource domain — the MCP-layer counterpart to the REST API's `registerResourceRoutes`. */
function registerResourceTools<T>(registerTool: LooseRegisterTool, store: OrgGraphStore, opts: ResourceToolOptions<T>): void {
  const { resourceName, pluralName, description, listInTeam, getById, listAcrossOrg } = opts;

  registerTool(
    `list_${pluralName}`,
    {
      title: `List ${pluralName}`,
      description: `List ${description}s. Pass teamId to scope to one team, or omit for an org-wide (optionally search-filtered) list.`,
      inputSchema: { teamId: z.string().optional(), search: z.string().min(1).optional() },
    },
    async ({ teamId, search }: { teamId?: string; search?: string }) => {
      if (teamId) {
        if (!getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
        return jsonResult(listInTeam(store.current, teamId));
      }
      return jsonResult(listAcrossOrg(store.current, search));
    },
  );

  registerTool(
    `get_${resourceName}`,
    {
      title: `Get ${description}`,
      description: `Get one ${description} by id, scoped to a team.`,
      inputSchema: { teamId: z.string(), resourceId: z.string() },
    },
    async ({ teamId, resourceId }: { teamId: string; resourceId: string }) => {
      if (!getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      const item = getById(store.current, teamId, resourceId);
      if (!item) return errorResult(`Unknown ${description} id '${resourceId}' on team '${teamId}'`);
      return jsonResult(item);
    },
  );
}

/** Registers every AI-native resource-domain tool: agents, memory, specifications, steering
 * documents, prompts (+ rendering), playbooks, policies, knowledge base, workflows, sessions,
 * context bundles, and the knowledge graph. */
export function registerKnowledgeTools(server: McpServer, store: OrgGraphStore): void {
  const registerTool = looseRegisterTool(server);

  registerResourceTools(registerTool, store, {
    resourceName: "agent",
    pluralName: "agents",
    description: "AI agent",
    listInTeam: listAgents,
    getById: getAgent,
    listAcrossOrg: listAllAgents,
  });

  registerResourceTools(registerTool, store, {
    resourceName: "memory_entry",
    pluralName: "memory_entries",
    description: "team memory entry",
    listInTeam: listMemory,
    getById: getMemoryEntry,
    listAcrossOrg: searchMemory,
  });

  registerResourceTools(registerTool, store, {
    resourceName: "specification",
    pluralName: "specifications",
    description: "specification",
    listInTeam: listSpecifications,
    getById: getSpecification,
    listAcrossOrg: listAllSpecifications,
  });

  registerResourceTools(registerTool, store, {
    resourceName: "playbook",
    pluralName: "playbooks",
    description: "playbook",
    listInTeam: listPlaybooks,
    getById: getPlaybook,
    listAcrossOrg: listAllPlaybooks,
  });

  registerResourceTools(registerTool, store, {
    resourceName: "policy",
    pluralName: "policies",
    description: "policy",
    listInTeam: listPolicies,
    getById: getPolicy,
    listAcrossOrg: listAllPolicies,
  });

  registerResourceTools(registerTool, store, {
    resourceName: "knowledge_base_entry",
    pluralName: "knowledge_base_entries",
    description: "knowledge base entry",
    listInTeam: listKnowledgeBase,
    getById: getKnowledgeBaseEntry,
    listAcrossOrg: searchKnowledgeBase,
  });

  registerResourceTools(registerTool, store, {
    resourceName: "workflow",
    pluralName: "workflows",
    description: "workflow",
    listInTeam: listWorkflows,
    getById: getWorkflow,
    listAcrossOrg: listAllWorkflows,
  });

  registerResourceTools(registerTool, store, {
    resourceName: "ai_session",
    pluralName: "ai_sessions",
    description: "AI collaboration session",
    listInTeam: listSessions,
    getById: getSession,
    listAcrossOrg: listAllSessions,
  });

  registerTool(
    "list_prompts",
    {
      title: "List prompts",
      description: "List prompts from the version-controlled prompt library. Pass teamId to scope to one team.",
      inputSchema: { teamId: z.string().optional(), search: z.string().min(1).optional() },
    },
    async ({ teamId, search }: { teamId?: string; search?: string }) => {
      if (teamId) {
        if (!getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
        return jsonResult(listPrompts(store.current, teamId));
      }
      return jsonResult(listAllPrompts(store.current, search));
    },
  );

  registerTool(
    "get_prompt",
    {
      title: "Get prompt",
      description: "Get one prompt by id, scoped to a team.",
      inputSchema: { teamId: z.string(), promptId: z.string() },
    },
    async ({ teamId, promptId }: { teamId: string; promptId: string }) => {
      if (!getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      const prompt = getPrompt(store.current, teamId, promptId);
      if (!prompt) return errorResult(`Unknown prompt id '${promptId}' on team '${teamId}'`);
      return jsonResult(prompt);
    },
  );

  registerTool(
    "render_prompt",
    {
      title: "Render prompt",
      description: "Fill a prompt's {{variable}} placeholders, falling back to each variable's declared default.",
      inputSchema: { teamId: z.string(), promptId: z.string(), variables: z.record(z.string()).optional() },
    },
    async ({ teamId, promptId, variables }: { teamId: string; promptId: string; variables?: Record<string, string> }) => {
      if (!getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      const prompt = getPrompt(store.current, teamId, promptId);
      if (!prompt) return errorResult(`Unknown prompt id '${promptId}' on team '${teamId}'`);
      try {
        return jsonResult({ rendered: renderPrompt(prompt, variables ?? {}) });
      } catch (err) {
        if (err instanceof MissingPromptVariableError) return errorResult(err.message);
        throw err;
      }
    },
  );

  registerTool(
    "list_steering_documents",
    {
      title: "List steering documents",
      description:
        "List a team's steering documents (coding standards, API conventions, security guidelines, architecture " +
        "principles, documentation style). Pass effective=true to also include organization-scoped documents " +
        "inherited from this team's platform-team chain.",
      inputSchema: { teamId: z.string(), effective: z.boolean().optional() },
    },
    async ({ teamId, effective }: { teamId: string; effective?: boolean }) => {
      if (!getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      return jsonResult(
        effective ? resolveEffectiveSteering(store.current, teamId) : listSteeringDocuments(store.current, teamId),
      );
    },
  );

  registerTool(
    "get_steering_document",
    {
      title: "Get steering document",
      description: "Get one steering document by id, scoped to a team.",
      inputSchema: { teamId: z.string(), documentId: z.string() },
    },
    async ({ teamId, documentId }: { teamId: string; documentId: string }) => {
      if (!getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      const doc = getSteeringDocument(store.current, teamId, documentId);
      if (!doc) return errorResult(`Unknown steering document id '${documentId}' on team '${teamId}'`);
      return jsonResult(doc);
    },
  );

  registerTool(
    "get_context_bundle",
    {
      title: "Get a context bundle",
      description:
        "Given a goal (e.g. 'Implement OAuth'), assembles the minimum high-quality set of specifications, steering " +
        "documents, policies, memory, knowledge base entries, prompts, and playbooks relevant to it, plus the " +
        "scoped team's related teams, members, and services when teamId is given. Relevance is a keyword-overlap " +
        "heuristic, not semantic search.",
      inputSchema: { goal: z.string().min(1), teamId: z.string().optional(), limit: z.number().int().positive().optional() },
    },
    async ({ goal, teamId, limit }: { goal: string; teamId?: string; limit?: number }) => {
      if (teamId && !getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      return jsonResult(deriveContextBundle(store.current, { goal, teamId, limit }));
    },
  );

  registerTool(
    "get_knowledge_graph",
    {
      title: "Get the knowledge graph",
      description:
        "Get every team, person, agent, and AI-native document as graph nodes, linked by ownership, role, " +
        "team-topology, and cross-team reference edges. Heavier; prefer traverse_knowledge_graph when scoped to one node.",
      inputSchema: {},
    },
    async () => jsonResult(deriveKnowledgeGraph(store.current)),
  );

  registerTool(
    "traverse_knowledge_graph",
    {
      title: "Traverse the knowledge graph",
      description:
        "Breadth-first traversal from a node id (e.g. 'team:stream-checkout', 'specification:stream-checkout:oauth-login-support'), " +
        "treating edges as undirected. Returns the reachable subgraph up to the given depth (default 2).",
      inputSchema: { nodeId: z.string().min(1), depth: z.number().int().nonnegative().optional() },
    },
    async ({ nodeId, depth }: { nodeId: string; depth?: number }) => {
      const graph = deriveKnowledgeGraph(store.current);
      if (!graph.nodes.some((n) => n.id === nodeId)) return errorResult(`Unknown knowledge graph node id '${nodeId}'`);
      return jsonResult(traverseKnowledgeGraph(graph, nodeId, depth ?? 2));
    },
  );
}
