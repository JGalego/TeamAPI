import type { FastifyInstance } from "fastify";
import { getTeam, type OrgGraph, type ResourceEntry } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

const teamIdParam = {
  type: "object",
  properties: { id: { type: "string", description: "Team id (slug), e.g. 'stream-checkout'" } },
  required: ["id"],
} as const;

export interface ResourceRouteOptions<T> {
  tag: string;
  /** URL path segment under `/teams/:id/`, e.g. `"agents"` -> `/teams/:id/agents`. */
  collectionPath: string;
  /** Singular, human-readable label used in generated summaries/descriptions/error messages. */
  resourceLabel: string;
  listInTeam: (graph: OrgGraph, teamId: string) => T[];
  getById: (graph: OrgGraph, teamId: string, resourceId: string) => T | undefined;
  listAcrossOrg: (graph: OrgGraph, search?: string) => ResourceEntry<T>[];
}

/**
 * Registers the read-only list/detail routes shared by every AI-native resource domain (agents,
 * memory, specifications, prompts, playbooks, policies, knowledge base, workflows, sessions):
 * `GET /<collectionPath>` (org-wide, searchable), `GET /teams/:id/<collectionPath>` (one team's
 * declared resources), and `GET /teams/:id/<collectionPath>/:resourceId` (one resource).
 *
 * Factored out once ten near-identical domains made the copy-pasted version of this genuinely
 * worse than a shared factory — steering documents are the one domain that *doesn't* use this
 * (its `effective=true` inheritance view needs a bespoke query param the others don't have).
 */
export function registerResourceRoutes<T>(app: FastifyInstance, opts: ResourceRouteOptions<T>): void {
  const { tag, collectionPath, resourceLabel, listInTeam, getById, listAcrossOrg } = opts;

  app.get<{ Querystring: { search?: string } }>(
    `/${collectionPath}`,
    {
      schema: {
        tags: [tag],
        summary: `List ${resourceLabel}s across the org`,
        description: `Every ${resourceLabel} declared across every team, each annotated with its owning team id.`,
        querystring: {
          type: "object",
          properties: { search: { type: "string", description: "Case-insensitive substring match on name/text/tags" } },
        },
      },
    },
    async (req) => listAcrossOrg(app.orgGraphStore.current, req.query.search),
  );

  app.get<{ Params: { id: string } }>(
    `/teams/:id/${collectionPath}`,
    {
      schema: {
        tags: [tag],
        summary: `List a team's ${resourceLabel}s`,
        params: teamIdParam,
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      return listInTeam(graph, req.params.id);
    },
  );

  app.get<{ Params: { id: string; resourceId: string } }>(
    `/teams/:id/${collectionPath}/:resourceId`,
    {
      schema: {
        tags: [tag],
        summary: `Get one ${resourceLabel} by id`,
        params: {
          type: "object",
          properties: {
            id: { type: "string", description: "Team id (slug)" },
            resourceId: { type: "string", description: `The ${resourceLabel}'s id` },
          },
          required: ["id", "resourceId"],
        },
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (!getTeam(graph, req.params.id)) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });
      const item = getById(graph, req.params.id, req.params.resourceId);
      if (!item) {
        return reply
          .code(404)
          .send({ error: `Unknown ${resourceLabel} id '${req.params.resourceId}' on team '${req.params.id}'` });
      }
      return item;
    },
  );
}
