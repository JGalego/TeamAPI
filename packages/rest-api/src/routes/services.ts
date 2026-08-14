import type { FastifyInstance } from "fastify";
import { findServiceOwner, listServices } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";
import { pageQuerySchema, paginate, type PageQuery } from "../pagination";

export async function servicesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: PageQuery & { search?: string } }>(
    "/services",
    {
      schema: {
        tags: ["Services"],
        summary: "List services",
        description: "All services declared across the org, each annotated with its owning team.",
        querystring: {
          type: "object",
          properties: {
            search: { type: "string", description: "Case-insensitive substring match on service name" },
            ...pageQuerySchema,
          },
        },
      },
    },
    async (req, reply) => {
      return paginate(listServices(app.orgGraphStore.current, req.query.search), req.query, req, reply);
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
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const result = findServiceOwner(app.orgGraphStore.current, req.params.name);
      if (!result) return reply.code(404).send({ error: `Unknown service '${req.params.name}'` });
      return result;
    },
  );
}
