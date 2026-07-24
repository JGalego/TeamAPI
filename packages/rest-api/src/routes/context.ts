import type { FastifyInstance } from "fastify";
import { deriveContextBundle, getTeam } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

export async function contextRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { goal?: string; teamId?: string; limit?: number } }>(
    "/context",
    {
      schema: {
        tags: ["Context"],
        summary: "Assemble a context bundle",
        description:
          "Given a goal (e.g. 'Implement OAuth'), assembles the minimum high-quality set of specifications, " +
          "steering documents, policies, memory, knowledge base entries, prompts, and playbooks relevant to it, " +
          "plus the scoped team's related teams, members, and services when teamId is given. Relevance is a " +
          "keyword-overlap heuristic, not semantic search.",
        body: {
          type: "object",
          properties: {
            goal: { type: "string", description: "What the requester is trying to accomplish" },
            teamId: { type: "string", description: "Scope the bundle to one team; boosts its own resources and adds relatedTeams/members/services" },
            limit: { type: "integer", minimum: 1, description: "Max items per resource category (default 5)" },
          },
          required: ["goal"],
        },
        response: { 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      if (!req.body?.goal) return reply.code(400).send({ error: "Missing required body field 'goal'" });
      const graph = app.orgGraphStore.current;
      if (req.body.teamId && !getTeam(graph, req.body.teamId)) {
        return reply.code(404).send({ error: `Unknown team id '${req.body.teamId}'` });
      }
      return deriveContextBundle(graph, { goal: req.body.goal, teamId: req.body.teamId, limit: req.body.limit });
    },
  );
}
