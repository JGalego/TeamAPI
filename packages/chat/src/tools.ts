// Schemas are built with zod's v4 API rather than the plain `zod` root import (which resolves to
// the classic v3 API `@jgalego/teamapi-core`/`-schema`/`-mcp-server` use), because both provider
// adapters want v4: the Anthropic helper is typed against v4's `ZodType`, and the
// OpenAI-compatible adapter needs `z.toJSONSchema`. A v3 schema passed where a v4 one is expected
// silently produces a wrong or incomplete input schema for the model instead of a type error. Zod
// 3.25+ bundles both APIs in one package, so this and the sibling packages' plain `zod` import
// still resolve to a single deduped `zod` install workspace-wide — not two coexisting majors.
import { z } from "zod/v4";
import type { ChatTool } from "./tool";
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
  planGaps,
  scoreCognitiveLoad,
  searchOrg,
  toDot,
  toMermaid,
  toTeamDetailDto,
  toTeamSummaryDto,
  type DiagramModel,
  type OrgGraph,
} from "@jgalego/teamapi-core";

const TeamTypeSchema = z.enum(["stream-aligned", "platform", "complicated-subsystem", "enabling"]);
const DirectionSchema = z.enum(["in", "out", "both"]);
const DiagramScopeSchema = z.enum(["topology", "hierarchy", "context-map", "org-hierarchy"]);
const DiagramFormatSchema = z.enum(["mermaid", "dot"]);

function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/** Identity, but it pins each tool's `run` input to its own `inputSchema` at the definition site.
 * Without it, `run`'s parameter is inferred as the widened union of every tool's input. */
function defineTool<S extends z.ZodType>(tool: ChatTool<S>): ChatTool<S> {
  return tool;
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
 * Builds the same 13 org-graph operations `@jgalego/teamapi-mcp-server` exposes over MCP, as
 * provider-neutral tool definitions — same underlying `@jgalego/teamapi-core` query functions,
 * different protocol adapter. Each tool closes over a single resolved `graph`: chat sessions are
 * one-shot, unlike the long-running REST/MCP servers, so there's no need for `OrgGraphStore`'s
 * reload.
 *
 * Neutral rather than Anthropic-shaped because the shape was the only thing tying this package to
 * one vendor. A tool is a name, a description, a zod schema and a function; the SDK-specific part
 * is a dozen lines per provider in `providers/`.
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
    defineTool({
      name: "list_teams",
      description: "List all teams in the org, optionally filtered by team type or a free-text search term.",
      inputSchema: z.object({ type: TeamTypeSchema.optional(), search: z.string().optional() }),
      run: withDebug("list_teams", async ({ type, search }) =>
        json(listTeams(graph, { type, search }).map(toTeamSummaryDto)),
      ),
    }),

    defineTool({
      name: "get_team",
      description: "Get full detail for one team by id: info, roles, members, services, cognitive load, meetings.",
      inputSchema: z.object({ teamId: z.string() }),
      run: withDebug("get_team", async ({ teamId }) => {
        const team = getTeam(graph, teamId);
        if (!team) return `Error: unknown team id '${teamId}'`;
        return json(toTeamDetailDto(team));
      }),
    }),

    defineTool({
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

    defineTool({
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

    defineTool({
      name: "find_service_owner",
      description: "Find which team owns a named service, including its DDD bounded-context info if declared.",
      inputSchema: z.object({ serviceName: z.string() }),
      run: withDebug("find_service_owner", async ({ serviceName }) => {
        const result = findServiceOwner(graph, serviceName);
        if (!result) return `Error: no service found matching '${serviceName}'`;
        return json(result);
      }),
    }),

    defineTool({
      name: "list_services",
      description: "List all services declared across the org, optionally filtered by a search term.",
      inputSchema: z.object({ search: z.string().optional() }),
      run: withDebug("list_services", async ({ search }) => json(listServices(graph, search))),
    }),

    defineTool({
      name: "get_team_interactions",
      description: "Get a team's Team Topologies interactions (collaboration / x-as-a-service / facilitating).",
      inputSchema: z.object({ teamId: z.string(), direction: DirectionSchema.optional() }),
      run: withDebug("get_team_interactions", async ({ teamId, direction }) => {
        const team = getTeam(graph, teamId);
        if (!team) return `Error: unknown team id '${teamId}'`;
        return json(getInteractions(graph, teamId, direction ?? "both"));
      }),
    }),

    defineTool({
      name: "get_context_map",
      description:
        "Derive a DDD context map from declared interactions, optionally scoped to one team. Surfaces conflicting mode declarations between two teams.",
      inputSchema: z.object({ teamId: z.string().optional() }),
      run: withDebug("get_context_map", async ({ teamId }) => {
        if (teamId && !getTeam(graph, teamId)) return `Error: unknown team id '${teamId}'`;
        return json(deriveContextMap(graph, teamId));
      }),
    }),

    defineTool({
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
        if (scope === "context-map")
          return render(buildContextMapDiagram(graph, deriveContextMap(graph, teamId), teamId));
        return render(buildTopologyDiagram(graph, teamId));
      }),
    }),

    defineTool({
      name: "search_org",
      description: "Unified search across team names/focus, services, roles, members, and search terms.",
      inputSchema: z.object({ query: z.string() }),
      run: withDebug("search_org", async ({ query }) => json(searchOrg(graph, query))),
    }),

    defineTool({
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

    defineTool({
      name: "get_org_cognitive_load_report",
      description: "Get every team's cognitive load assessment and label, sorted highest total first.",
      inputSchema: z.object({}),
      run: withDebug("get_org_cognitive_load_report", async () => json(orgWideCognitiveLoadReport(graph))),
    }),

    defineTool({
      name: "get_org_gaps",
      description:
        "Find the accountability holes between teams rather than inside any one of them: services subscribing " +
        "to events nothing publishes, agents whose ownerId names nobody on the team, vacant roles other teams " +
        "report into, one-sided collaborations, and teams running agents without scoring the supervision load. " +
        "Use this to answer 'what is nobody responsible for here?'.",
      inputSchema: z.object({}),
      run: withDebug("get_org_gaps", async () => json(planGaps(graph))),
    }),
  ];
}
