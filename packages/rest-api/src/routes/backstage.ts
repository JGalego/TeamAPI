import type { FastifyInstance } from "fastify";
import { buildBackstageOrgCatalog, getTeam, toBackstageYaml } from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

/**
 * The Backstage catalog, served rather than generated into a file.
 *
 * `teamapi generate backstage` writes `catalog-info.yaml` files, which is the right answer for an
 * org that wants the catalog in git. It is the wrong answer for the org that already has one,
 * because a generated file is a snapshot: somebody re-runs the command, or they do not, and the
 * catalog is stale from the moment a team document changes until somebody remembers.
 *
 * This is the same generator behind an endpoint, so a Backstage entity provider can poll it and
 * the catalog is never further behind than one refresh interval. Same code, same tests, no second
 * mapping to keep in sync — which is the failure a "live" integration usually introduces.
 */
export async function backstageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { format?: "json" | "yaml"; teamId?: string } }>(
    "/backstage/catalog",
    {
      schema: {
        tags: ["Backstage"],
        summary: "The org as Backstage catalog entities",
        description:
          "Every team as a Group, every member as a User, and each team's services as a System plus one " +
          "Component each — the same entities `teamapi generate backstage` writes, served live so a catalog " +
          "cannot drift from the org graph between regenerations.",
        querystring: {
          type: "object",
          properties: {
            format: {
              type: "string",
              enum: ["json", "yaml"],
              default: "json",
              description: "json for an entity array (what an entity provider wants), yaml for catalog-info.yaml",
            },
            teamId: { type: "string", description: "Scope to one team" },
          },
        },
        response: { 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const graph = app.orgGraphStore.current;
      if (req.query.teamId && !getTeam(graph, req.query.teamId)) {
        return reply.code(404).send({ error: `Unknown team id '${req.query.teamId}'` });
      }

      const entities = buildBackstageOrgCatalog(graph).filter(
        // Scoped by owner rather than by re-generating one team's catalog, so a scoped request and
        // an unscoped one can never disagree about what a team's entities are.
        (entity) =>
          !req.query.teamId ||
          entity.metadata.name === req.query.teamId ||
          ("owner" in entity.spec && entity.spec.owner === `group:${req.query.teamId}`) ||
          ("memberOf" in entity.spec && entity.spec.memberOf.includes(req.query.teamId)),
      );

      if (req.query.format === "yaml") {
        return reply.type("text/yaml").send(toBackstageYaml(entities));
      }
      return entities;
    },
  );
}
