import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TeamTypeSchema } from "@jgalego/teamapi-schema";
import {
  buildContextMapDiagram,
  buildHierarchyDiagram,
  buildOrgHierarchyDiagram,
  buildTopologyDiagram,
  deriveContextMap,
  findServiceOwner,
  getDependencies,
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
  toOrgGraphDto,
  toTeamDetailDto,
  toTeamSummaryDto,
  type OrgGraphStore,
} from "@jgalego/teamapi-core";
import { errorResult, jsonResult, textResult } from "./result";
import { looseRegisterTool } from "./loose-register";
import { registerKnowledgeTools } from "./register-knowledge";

const DiagramScopeSchema = z.enum(["topology", "hierarchy", "context-map", "org-hierarchy"]);
const DiagramFormatSchema = z.enum(["mermaid", "dot"]);
const DirectionSchema = z.enum(["in", "out", "both"]);

/** Registers every Team API tool on `server`, all reading from the same live `store`. */
export function registerTools(server: McpServer, store: OrgGraphStore): void {
  const registerTool = looseRegisterTool(server);

  registerTool(
    "list_teams",
    {
      title: "List teams",
      description: "List all teams in the org, optionally filtered by team type or a free-text search term.",
      inputSchema: { type: TeamTypeSchema.optional(), search: z.string().min(1).optional() },
    },
    async ({ type, search }: { type?: string; search?: string }) =>
      jsonResult(listTeams(store.current, { type, search }).map(toTeamSummaryDto)),
  );

  registerTool(
    "get_team",
    {
      title: "Get team detail",
      description: "Get full detail for one team by id: info, roles, members, services, cognitive load, meetings.",
      inputSchema: { teamId: z.string() },
    },
    async ({ teamId }: { teamId: string }) => {
      const team = getTeam(store.current, teamId);
      if (!team) return errorResult(`Unknown team id '${teamId}'`);
      return jsonResult(toTeamDetailDto(team));
    },
  );

  registerTool(
    "get_team_roles",
    {
      title: "Get team roles",
      description:
        "Get the role/reporting hierarchy for one team (positions, independent of who fills them) plus the members currently assigned to each role.",
      inputSchema: { teamId: z.string() },
    },
    async ({ teamId }: { teamId: string }) => {
      const team = getTeam(store.current, teamId);
      if (!team) return errorResult(`Unknown team id '${teamId}'`);
      return jsonResult({
        roles: listRoles(store.current, teamId).map((r) => r.role),
        members: listMembers(store.current, teamId).map((m) => m.member),
      });
    },
  );

  registerTool(
    "get_team_cognitive_load",
    {
      title: "Get team cognitive load",
      description: "Get a team's cognitive load self-assessment and derived sustainable/elevated/overloaded label.",
      inputSchema: { teamId: z.string() },
    },
    async ({ teamId }: { teamId: string }) => {
      const team = getTeam(store.current, teamId);
      if (!team) return errorResult(`Unknown team id '${teamId}'`);
      if (!team.doc.cognitiveLoad) return errorResult(`Team '${teamId}' has no cognitiveLoad assessment`);
      return jsonResult({ teamId, ...scoreCognitiveLoad(team.doc.cognitiveLoad) });
    },
  );

  registerTool(
    "find_service_owner",
    {
      title: "Find service owner",
      description:
        "Find which team owns a named service, including its DDD bounded-context info if declared. Requires " +
        "an exact (case-insensitive) service name match — use list_services or search_org for a partial/substring " +
        "match instead.",
      inputSchema: { serviceName: z.string().min(1) },
    },
    async ({ serviceName }: { serviceName: string }) => {
      const result = findServiceOwner(store.current, serviceName);
      if (!result) {
        return errorResult(
          `No service found with the exact name '${serviceName}'. Try list_services or search_org for a partial match.`,
        );
      }
      return jsonResult(result);
    },
  );

  registerTool(
    "list_services",
    {
      title: "List services",
      description: "List all services declared across the org, optionally filtered by a search term.",
      inputSchema: { search: z.string().min(1).optional() },
    },
    async ({ search }: { search?: string }) => jsonResult(listServices(store.current, search)),
  );

  registerTool(
    "get_team_interactions",
    {
      title: "Get team interactions",
      description: "Get a team's Team Topologies interactions (collaboration / x-as-a-service / facilitating).",
      inputSchema: { teamId: z.string(), direction: DirectionSchema.optional() },
    },
    async ({ teamId, direction }: { teamId: string; direction?: "in" | "out" | "both" }) => {
      const team = getTeam(store.current, teamId);
      if (!team) return errorResult(`Unknown team id '${teamId}'`);
      return jsonResult(getInteractions(store.current, teamId, direction ?? "both"));
    },
  );

  registerTool(
    "get_team_dependencies",
    {
      title: "Get team dependencies",
      description:
        "Get a team's dependencies on other teams (or, with direction='in', which teams depend on it), each " +
        "flagged OK/Slowing/Blocking.",
      inputSchema: { teamId: z.string(), direction: DirectionSchema.optional() },
    },
    async ({ teamId, direction }: { teamId: string; direction?: "in" | "out" | "both" }) => {
      const team = getTeam(store.current, teamId);
      if (!team) return errorResult(`Unknown team id '${teamId}'`);
      return jsonResult(getDependencies(store.current, teamId, direction ?? "out"));
    },
  );

  registerTool(
    "get_context_map",
    {
      title: "Get DDD context map",
      description:
        "Derive a DDD context map from declared interactions, optionally scoped to one team. Surfaces conflicting mode declarations between two teams.",
      inputSchema: { teamId: z.string().optional() },
    },
    async ({ teamId }: { teamId?: string }) => {
      if (teamId && !getTeam(store.current, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      return jsonResult(deriveContextMap(store.current, teamId));
    },
  );

  registerTool(
    "render_org_diagram",
    {
      title: "Render an org diagram",
      description:
        "Render a Mermaid or DOT diagram: 'topology' (team interaction organigram, optionally scoped to one team's neighborhood), 'hierarchy' (one team's role/reporting chart, requires teamId), 'org-hierarchy' (every team's role hierarchy grouped into one box per team, with cross-team reportsTo/alignsWith relationships), or 'context-map' (DDD relationship diagram).",
      inputSchema: {
        scope: DiagramScopeSchema,
        teamId: z.string().optional(),
        format: DiagramFormatSchema.optional(),
      },
    },
    async ({
      scope,
      teamId,
      format,
    }: {
      scope: "topology" | "hierarchy" | "context-map" | "org-hierarchy";
      teamId?: string;
      format?: "mermaid" | "dot";
    }) => {
      const graph = store.current;
      if (teamId && !getTeam(graph, teamId)) return errorResult(`Unknown team id '${teamId}'`);
      const fmt = format ?? "mermaid";
      const render = (model: Parameters<typeof toMermaid>[0]) => (fmt === "dot" ? toDot(model) : toMermaid(model));

      if (scope === "hierarchy") {
        if (!teamId) return errorResult("scope 'hierarchy' requires a teamId");
        return textResult(render(buildHierarchyDiagram(graph, teamId)));
      }
      if (scope === "org-hierarchy") {
        return textResult(render(buildOrgHierarchyDiagram(graph)));
      }
      if (scope === "context-map") {
        return textResult(render(buildContextMapDiagram(graph, deriveContextMap(graph, teamId), teamId)));
      }
      return textResult(render(buildTopologyDiagram(graph, teamId)));
    },
  );

  registerTool(
    "search_org",
    {
      title: "Search the org",
      description: "Unified search across team names/focus, services, roles, members, and search terms.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }: { query: string }) => jsonResult(searchOrg(store.current, query)),
  );

  registerTool(
    "get_org_graph",
    {
      title: "Get the full org graph",
      description:
        "Get the full resolved org graph (all teams + all team-level edges + all role-level reportsTo/alignsWith " +
        "edges) as JSON. Heavier; prefer narrower tools when possible.",
      inputSchema: {},
    },
    async () => jsonResult(toOrgGraphDto(store.current)),
  );

  registerTool(
    "get_org_cognitive_load_report",
    {
      title: "Get org-wide cognitive load report",
      description: "Get every team's cognitive load assessment and label, sorted highest total first.",
      inputSchema: {},
    },
    async () => jsonResult(orgWideCognitiveLoadReport(store.current)),
  );

  registerKnowledgeTools(server, store);
}
