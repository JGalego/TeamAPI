import type { FastifyInstance } from "fastify";
import { buildAgentFleet, routeAgentTask, type AgentRouteRequest } from "@jgalego/teamapi-core";

const routeBodySchema = {
  type: "object",
  properties: {
    capability: { type: "string", minLength: 1 },
    permissions: { type: "array", items: { type: "string" } },
    preferredTeamId: { type: "string" },
    requireOwner: { type: "boolean" },
  },
  required: ["capability"],
  additionalProperties: false,
} as const;

export async function agentControlPlaneRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/agents/fleet",
    {
      schema: {
        tags: ["Agents"],
        summary: "Inventory and assess the AI agent fleet",
        description: "Returns a deterministic fleet inventory with ownership and supervision governance health.",
      },
    },
    async () => buildAgentFleet(app.orgGraphStore.current),
  );

  app.post<{ Body: AgentRouteRequest }>(
    "/agents/route",
    {
      schema: {
        tags: ["Agents"],
        summary: "Select an agent for a task",
        description:
          "Dry-runs deterministic, capability- and permission-aware agent selection. This endpoint never invokes an agent.",
        body: routeBodySchema,
      },
    },
    async (request) => routeAgentTask(app.orgGraphStore.current, request.body),
  );
}
