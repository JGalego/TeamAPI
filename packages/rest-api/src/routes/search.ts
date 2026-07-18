import type { FastifyInstance } from "fastify";
import { searchOrg } from "@jgalego/teamapi-core";

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { q?: string } }>(
    "/search",
    {
      schema: {
        tags: ["Search"],
        summary: "Search the org",
        description: "Unified search across team names/focus, services, roles, members, and search terms.",
        querystring: {
          type: "object",
          properties: { q: { type: "string", description: "Search query" } },
          required: ["q"],
        },
      },
    },
    async (req, reply) => {
      if (!req.query.q) return reply.code(400).send({ error: "Missing required query parameter 'q'" });
      return searchOrg(app.orgGraphStore.current, req.query.q);
    },
  );
}
