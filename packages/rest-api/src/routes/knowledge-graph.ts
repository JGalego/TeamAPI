import type { FastifyInstance } from "fastify";
import { deriveKnowledgeGraph, traverseKnowledgeGraph } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

export async function knowledgeGraphRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/knowledge-graph",
    {
      schema: {
        tags: ["Knowledge Graph"],
        summary: "Get the full knowledge graph",
        description:
          "Every team, person, agent, and AI-native document (specifications, steering documents, prompts, " +
          "playbooks, policies, knowledge base, workflows, memory, sessions) as graph nodes, linked by ownership, " +
          "role, team-topology, and cross-team reference edges.",
      },
    },
    async () => deriveKnowledgeGraph(app.orgGraphStore.current),
  );

  app.get<{ Params: { nodeId: string }; Querystring: { depth?: number } }>(
    "/knowledge-graph/:nodeId/traverse",
    {
      schema: {
        tags: ["Knowledge Graph"],
        summary: "Traverse the knowledge graph from one node",
        description:
          "Breadth-first traversal from a node id (e.g. 'team:stream-checkout', 'specification:stream-checkout:oauth-login-support'), " +
          "treating edges as undirected. Returns the reachable subgraph up to the given depth (default 2).",
        params: {
          type: "object",
          properties: { nodeId: { type: "string", description: "e.g. 'team:stream-checkout'" } },
          required: ["nodeId"],
        },
        querystring: {
          type: "object",
          properties: { depth: { type: "integer", minimum: 0, description: "Max hops from the starting node (default 2)" } },
        },
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const graph = deriveKnowledgeGraph(app.orgGraphStore.current);
      if (!graph.nodes.some((n) => n.id === req.params.nodeId)) {
        return reply.code(404).send({ error: `Unknown knowledge graph node id '${req.params.nodeId}'` });
      }
      return traverseKnowledgeGraph(graph, req.params.nodeId, req.query.depth ?? 2);
    },
  );
}
