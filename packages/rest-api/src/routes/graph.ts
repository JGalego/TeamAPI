import type { FastifyInstance } from "fastify";
import { toTeamDetailDto } from "@jgalego/teamapi-core";

export async function graphRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/graph",
    {
      schema: {
        tags: ["Graph"],
        summary: "Get the full org graph",
        description: "Every resolved team plus every edge (interaction/dependency/platform), as JSON.",
      },
    },
    async () => {
      const graph = app.orgGraphStore.current;
      return {
        teams: [...graph.teams.values()].map(toTeamDetailDto),
        edges: graph.edges,
        unresolved: graph.unresolved,
        meta: graph.meta,
      };
    },
  );
}
