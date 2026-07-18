import type { FastifyInstance } from "fastify";
import { findServiceOwner, listServices } from "@jgalego/teamapi-core";

export async function servicesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { search?: string } }>(
    "/services",
    {
      schema: {
        tags: ["Services"],
        summary: "List services",
        description: "All services declared across the org, each annotated with its owning team.",
        querystring: {
          type: "object",
          properties: { search: { type: "string", description: "Case-insensitive substring match on service name" } },
        },
      },
    },
    async (req) => {
      return listServices(app.orgGraphStore.current, req.query.search);
    },
  );

  app.get<{ Params: { name: string } }>(
    "/services/:name",
    {
      schema: {
        tags: ["Services"],
        summary: "Find service owner",
        description: "Find which team owns a named service, including its DDD bounded-context info if declared.",
        params: {
          type: "object",
          properties: { name: { type: "string", description: "Exact service name, e.g. 'payments-api'" } },
          required: ["name"],
        },
      },
    },
    async (req, reply) => {
      const result = findServiceOwner(app.orgGraphStore.current, req.params.name);
      if (!result) return reply.code(404).send({ error: `Unknown service '${req.params.name}'` });
      return result;
    },
  );
}
