import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import {
  buildContextMapDiagram,
  buildHierarchyDiagram,
  buildOrgHierarchyDiagram,
  buildTopologyDiagram,
  deriveContextMap,
  findServiceOwner,
  getInteractions,
  getTeam,
  listMembers,
  listRoles,
  listServices,
  listTeams,
  orgWideCognitiveLoadReport,
  scoreCognitiveLoad,
  searchOrg,
  toDot,
  toMermaid,
  toTeamDetailDto,
  toTeamSummaryDto,
  type DiagramModel,
  type OrgGraph,
} from "@teamapi/core";

const TeamTypeSchema = z.enum(["stream-aligned", "platform", "complicated-subsystem", "enabling"]);
const DirectionSchema = z.enum(["in", "out", "both"]);
const DiagramScopeSchema = z.enum(["topology", "hierarchy", "context-map", "org-hierarchy"]);
const DiagramFormatSchema = z.enum(["mermaid", "dot"]);

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export interface ChatToolCall {
  name: string;
  input: unknown;
  output: string;
}

export interface ChatToolsOptions {
  /** Called after every tool invocation, e.g. for `teamapi chat --debug` to print what ran. */
  onToolCall?: (call: ChatToolCall) => void;
}

/**
 * Builds the same ~12 org-graph operations `@teamapi/mcp-server` exposes over MCP, as Anthropic
 * tool-use tools instead — same underlying `@teamapi/core` query functions, different protocol
 * adapter. Each tool closes over a single resolved `graph`: chat sessions are one-shot, unlike the
 * long-running REST/MCP servers, so there's no need for `OrgGraphStore`'s reload.
 */
export function buildChatTools(graph: OrgGraph, options: ChatToolsOptions = {}) {
  const { onToolCall } = options;

  function withDebug<Input>(name: string, run: (input: Input) => Promise<string>) {
    return async (input: Input) => {
      const output = await run(input);
      onToolCall?.({ name, input, output });
      return output;
    };
  }

  return [
    betaZodTool({
      name: "list_teams",
      description: "List all teams in the org, optionally filtered by team type or a free-text search term.",
      inputSchema: z.object({ type: TeamTypeSchema.optional(), search: z.string().optional() }),
      run: withDebug("list_teams", async ({ type, search }) =>
        json(listTeams(graph, { type, search }).map(toTeamSummaryDto)),
      ),
    }),

    betaZodTool({
      name: "get_team",
      description: "Get full detail for one team by id: info, roles, members, services, cognitive load, meetings.",
      inputSchema: z.object({ teamId: z.string() }),
      run: withDebug("get_team", async ({ teamId }) => {
        const team = getTeam(graph, teamId);
        if (!team) return `Error: unknown team id '${teamId}'`;
        return json(toTeamDetailDto(team));
      }),
    }),

    betaZodTool({
      name: "get_team_roles",
      description:
        "Get the role/reporting hierarchy for one team (positions, independent of who fills them) plus the members currently assigned to each role.",
      inputSchema: z.object({ teamId: z.string() }),
      run: withDebug("get_team_roles", async ({ teamId }) => {
        const team = getTeam(graph, teamId);
        if (!team) return `Error: unknown team id '${teamId}'`;
        return json({
          roles: listRoles(graph, teamId).map((r) => r.role),
          members: listMembers(graph, teamId).map((m) => m.member),
        });
      }),
    }),

    betaZodTool({
      name: "get_team_cognitive_load",
      description: "Get a team's cognitive load self-assessment and derived sustainable/elevated/overloaded label.",
      inputSchema: z.object({ teamId: z.string() }),
      run: withDebug("get_team_cognitive_load", async ({ teamId }) => {
        const team = getTeam(graph, teamId);
        if (!team) return `Error: unknown team id '${teamId}'`;
        if (!team.doc.cognitiveLoad) return `Error: team '${teamId}' has no cognitiveLoad assessment`;
        return json({ teamId, ...scoreCognitiveLoad(team.doc.cognitiveLoad) });
      }),
    }),

    betaZodTool({
      name: "find_service_owner",
      description: "Find which team owns a named service, including its DDD bounded-context info if declared.",
      inputSchema: z.object({ serviceName: z.string() }),
      run: withDebug("find_service_owner", async ({ serviceName }) => {
        const result = findServiceOwner(graph, serviceName);
        if (!result) return `Error: no service found matching '${serviceName}'`;
        return json(result);
      }),
    }),

    betaZodTool({
      name: "list_services",
      description: "List all services declared across the org, optionally filtered by a search term.",
      inputSchema: z.object({ search: z.string().optional() }),
      run: withDebug("list_services", async ({ search }) => json(listServices(graph, search))),
    }),

    betaZodTool({
      name: "get_team_interactions",
      description: "Get a team's Team Topologies interactions (collaboration / x-as-a-service / facilitating).",
      inputSchema: z.object({ teamId: z.string(), direction: DirectionSchema.optional() }),
      run: withDebug("get_team_interactions", async ({ teamId, direction }) => {
        const team = getTeam(graph, teamId);
        if (!team) return `Error: unknown team id '${teamId}'`;
        return json(getInteractions(graph, teamId, direction ?? "both"));
      }),
    }),

    betaZodTool({
      name: "get_context_map",
      description:
        "Derive a DDD context map from declared interactions, optionally scoped to one team. Surfaces conflicting mode declarations between two teams.",
      inputSchema: z.object({ teamId: z.string().optional() }),
      run: withDebug("get_context_map", async ({ teamId }) => {
        if (teamId && !getTeam(graph, teamId)) return `Error: unknown team id '${teamId}'`;
        return json(deriveContextMap(graph, teamId));
      }),
    }),

    betaZodTool({
      name: "render_org_diagram",
      description:
        "Render a Mermaid or DOT diagram: 'topology' (team interaction organigram, optionally scoped to one team's neighborhood), 'hierarchy' (one team's role/reporting chart, requires teamId), 'org-hierarchy' (every team's role hierarchy grouped into one box per team, with cross-team reportsTo/alignsWith relationships), or 'context-map' (DDD relationship diagram).",
      inputSchema: z.object({
        scope: DiagramScopeSchema,
        teamId: z.string().optional(),
        format: DiagramFormatSchema.optional(),
      }),
      run: withDebug("render_org_diagram", async ({ scope, teamId, format }) => {
        if (teamId && !getTeam(graph, teamId)) return `Error: unknown team id '${teamId}'`;
        const fmt = format ?? "mermaid";
        const render = (model: DiagramModel) => (fmt === "dot" ? toDot(model) : toMermaid(model));

        if (scope === "hierarchy") {
          if (!teamId) return "Error: scope 'hierarchy' requires a teamId";
          return render(buildHierarchyDiagram(graph, teamId));
        }
        if (scope === "org-hierarchy") return render(buildOrgHierarchyDiagram(graph));
        if (scope === "context-map") return render(buildContextMapDiagram(graph, deriveContextMap(graph, teamId), teamId));
        return render(buildTopologyDiagram(graph, teamId));
      }),
    }),

    betaZodTool({
      name: "search_org",
      description: "Unified search across team names/focus, services, roles, members, and search terms.",
      inputSchema: z.object({ query: z.string() }),
      run: withDebug("search_org", async ({ query }) => json(searchOrg(graph, query))),
    }),

    betaZodTool({
      name: "get_org_graph",
      description:
        "Get the full resolved org graph (all teams + all edges) as JSON. Heavier; prefer narrower tools when possible.",
      inputSchema: z.object({}),
      run: withDebug("get_org_graph", async () =>
        json({
          teams: [...graph.teams.values()].map(toTeamDetailDto),
          edges: graph.edges,
          unresolved: graph.unresolved,
          meta: graph.meta,
        }),
      ),
    }),

    betaZodTool({
      name: "get_org_cognitive_load_report",
      description: "Get every team's cognitive load assessment and label, sorted highest total first.",
      inputSchema: z.object({}),
      run: withDebug("get_org_cognitive_load_report", async () => json(orgWideCognitiveLoadReport(graph))),
    }),
  ];
}
