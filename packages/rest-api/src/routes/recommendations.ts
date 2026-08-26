import type { FastifyInstance } from "fastify";
import { buildRecommendationDiagram, recommendOrgChanges, toMermaid, type EvidenceLedger } from "@jgalego/teamapi-core";

export interface RecommendationRouteOptions {
  ledger: EvidenceLedger;
}

export async function recommendationRoutes(app: FastifyInstance, options: RecommendationRouteOptions): Promise<void> {
  app.get<{ Querystring: { minimumConfidence?: string } }>(
    "/recommendations",
    {
      schema: {
        tags: ["Recommendations"],
        summary: "Get evidence-backed organization recommendations",
        description:
          "Combines graph gaps, policy findings, cognitive load, and incident evidence into deterministic recommendations and a Mermaid pressure map.",
        querystring: {
          type: "object",
          properties: {
            minimumConfidence: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const minimumConfidence = Number(request.query.minimumConfidence ?? 0.5);
      const recommendations = recommendOrgChanges(app.orgGraphStore.current, options.ledger, { minimumConfidence });
      const diagram = buildRecommendationDiagram(recommendations);
      return { recommendations, diagram, mermaid: toMermaid(diagram) };
    },
  );
}
