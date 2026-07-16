import type { FastifyInstance } from "fastify";
import { buildContextMapDiagram, deriveContextMap, toDot, toMermaid } from "@teamapi/core";

type Format = "json" | "mermaid" | "dot";

export async function contextMapRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { format?: Format; teamId?: string } }>(
    "/context-map",
    {
      schema: {
        tags: ["Context Map"],
        summary: "Derive the DDD context map",
        description:
          "Derives a DDD context map from declared interactions (explicit contextMappingPattern, or a mode-based heuristic), optionally scoped to one team. Surfaces conflicting mode declarations between two teams as `conflicts`.",
        querystring: {
          type: "object",
          properties: {
            format: {
              type: "string",
              enum: ["json", "mermaid", "dot"],
              default: "json",
              description: "json for structured relationships/conflicts, mermaid/dot for a rendered diagram",
            },
            teamId: { type: "string", description: "Scope to one team" },
          },
        },
      },
    },
    async (req, reply) => {
      const format = req.query.format ?? "json";
      const graph = app.orgGraphStore.current;
      if (req.query.teamId && !graph.teams.has(req.query.teamId)) {
        return reply.code(404).send({ error: `Unknown team id '${req.query.teamId}'` });
      }
      const contextMap = deriveContextMap(graph, req.query.teamId);
      if (format === "json") return contextMap;

      const model = buildContextMapDiagram(graph, contextMap, req.query.teamId);
      return reply.type("text/plain").send(format === "dot" ? toDot(model) : toMermaid(model));
    },
  );
}
