import type { FastifyInstance } from "fastify";
import { createEmbeddingScorer, deriveContextBundle, getTeam } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

export async function contextRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { goal?: string; teamId?: string; limit?: number; semantic?: boolean } }>(
    "/context",
    {
      schema: {
        tags: ["Context"],
        summary: "Assemble a context bundle",
        description:
          "Given a goal (e.g. 'Implement OAuth'), assembles the minimum high-quality set of specifications, " +
          "steering documents, policies, memory, knowledge base entries, prompts, and playbooks relevant to it, " +
          "plus the scoped team's related teams, members, and services when teamId is given. Relevance is a " +
          "keyword overlap by default; set semantic=true to additionally rank by embedding " +
          "similarity, which requires the server to have been started with an embedding model.",
        body: {
          type: "object",
          properties: {
            goal: { type: "string", description: "What the requester is trying to accomplish" },
            teamId: {
              type: "string",
              description:
                "Scope the bundle to one team; boosts its own resources and adds relatedTeams/members/services",
            },
            limit: { type: "integer", minimum: 1, description: "Max items per resource category (default 5)" },
            semantic: {
              type: "boolean",
              description: "Layer embedding similarity on top of keyword overlap. Needs --embeddings on the server.",
              default: false,
            },
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
      let scorer;
      if (req.body.semantic) {
        if (!app.embeddings) {
          return reply
            .code(400)
            .send({ error: "semantic=true requires an embedding model; start the server with --embeddings" });
        }
        scorer = await createEmbeddingScorer(graph, req.body.goal, { embeddings: app.embeddings }, req.body.teamId);
      }
      return deriveContextBundle(graph, {
        goal: req.body.goal,
        teamId: req.body.teamId,
        limit: req.body.limit,
        scorer,
      });
    },
  );
}
