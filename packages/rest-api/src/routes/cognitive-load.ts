import type { FastifyInstance } from "fastify";
import { getTeam, orgWideCognitiveLoadReport, scoreCognitiveLoad } from "@jgalego/teamapi-core";

export async function cognitiveLoadRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/cognitive-load",
    {
      schema: {
        tags: ["Cognitive Load"],
        summary: "Org-wide cognitive load report",
        description: "Every team's cognitive load assessment and derived label, sorted highest total first.",
      },
    },
    async () => {
      return orgWideCognitiveLoadReport(app.orgGraphStore.current);
    },
  );

  app.get<{ Params: { teamId: string } }>(
    "/cognitive-load/:teamId",
    {
      schema: {
        tags: ["Cognitive Load"],
        summary: "Get one team's cognitive load",
        description: "A team's cognitive load self-assessment and derived sustainable/elevated/overloaded label.",
        params: {
          type: "object",
          properties: { teamId: { type: "string", description: "Team id (slug)" } },
          required: ["teamId"],
        },
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      const team = getTeam(graph, req.params.teamId);
      if (!team) return reply.code(404).send({ error: `Unknown team id '${req.params.teamId}'` });
      if (!team.doc.cognitiveLoad) {
        return reply.code(404).send({ error: `Team '${req.params.teamId}' has no cognitiveLoad assessment` });
      }
      return { teamId: team.id, ...scoreCognitiveLoad(team.doc.cognitiveLoad) };
    },
  );
}
