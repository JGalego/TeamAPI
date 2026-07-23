import type { FastifyInstance } from "fastify";
import { searchOrg } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

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
        },
        response: { 400: errorResponseSchema },
      },
    },
    async (req, reply) => {
      // `q` is intentionally not `required` in the querystring schema above: that would make
      // Fastify's AJV validation reject a missing `q` before this handler runs, with a different
      // (less friendly, AJV-generated) error body than the one below — so both "absent" and
      // "present but empty" land on the same, single error message here.
      if (!req.query.q) return reply.code(400).send({ error: "Missing required query parameter 'q'" });
      return searchOrg(app.orgGraphStore.current, req.query.q);
    },
  );
}
