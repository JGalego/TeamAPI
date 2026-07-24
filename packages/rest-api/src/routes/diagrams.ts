import type { FastifyInstance } from "fastify";
import {
  buildHierarchyDiagram,
  buildOrgHierarchyDiagram,
  buildTopologyDiagram,
  toDot,
  toMermaid,
  type DiagramModel,
} from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

type Format = "mermaid" | "dot";

function render(model: DiagramModel, format: Format): string {
  return format === "dot" ? toDot(model) : toMermaid(model);
}

const formatProperty = {
  type: "string",
  enum: ["mermaid", "dot"],
  default: "mermaid",
  description: "Diagram output format",
} as const;

export async function diagramsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { format?: Format; teamId?: string } }>(
    "/diagrams/topology",
    {
      schema: {
        tags: ["Diagrams"],
        summary: "Render the team-interaction organigram",
        description:
          "All teams (or, with teamId, just one team's neighborhood) as nodes, with interactions/dependencies/platform-membership as edges. Response body is raw Mermaid/DOT text.",
        querystring: {
          type: "object",
          properties: {
            format: formatProperty,
            teamId: { type: "string", description: "Scope to one team's neighborhood" },
          },
        },
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const format = req.query.format ?? "mermaid";
      const graph = app.orgGraphStore.current;
      if (req.query.teamId && !graph.teams.has(req.query.teamId)) {
        return reply.code(404).send({ error: `Unknown team id '${req.query.teamId}'` });
      }
      const model = buildTopologyDiagram(graph, req.query.teamId);
      return reply.type("text/plain").send(render(model, format));
    },
  );

  app.get<{ Params: { teamId: string }; Querystring: { format?: Format } }>(
    "/diagrams/hierarchy/:teamId",
    {
      schema: {
        tags: ["Diagrams"],
        summary: "Render a team's role hierarchy",
        description:
          "One team's roles[]/reportsTo tree, annotated with members[]. Response body is raw Mermaid/DOT text.",
        params: {
          type: "object",
          properties: { teamId: { type: "string", description: "Team id (slug)" } },
          required: ["teamId"],
        },
        querystring: { type: "object", properties: { format: formatProperty } },
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const format = req.query.format ?? "mermaid";
      const graph = app.orgGraphStore.current;
      if (!graph.teams.has(req.params.teamId)) {
        return reply.code(404).send({ error: `Unknown team id '${req.params.teamId}'` });
      }
      const model = buildHierarchyDiagram(graph, req.params.teamId);
      return reply.type("text/plain").send(render(model, format));
    },
  );

  app.get<{ Querystring: { format?: Format } }>(
    "/diagrams/org-hierarchy",
    {
      schema: {
        tags: ["Diagrams"],
        summary: "Render the org-wide role hierarchy",
        description:
          "Every team's roles[]/reportsTo tree grouped into one box per team, plus cross-team " +
          "reportsToRef and alignsWith relationships. Response body is raw Mermaid/DOT text.",
        querystring: { type: "object", properties: { format: formatProperty } },
      },
    },
    async (req, reply) => {
      const format = req.query.format ?? "mermaid";
      const model = buildOrgHierarchyDiagram(app.orgGraphStore.current);
      return reply.type("text/plain").send(render(model, format));
    },
  );
}
