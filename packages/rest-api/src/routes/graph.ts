import type { FastifyInstance } from "fastify";
import { toOrgGraphDto } from "@jgalego/teamapi-core";

export async function graphRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/graph",
    {
      schema: {
        tags: ["Graph"],
        summary: "Get the full org graph",
        description:
          "Every resolved team plus every team-level edge (interaction/dependency/platform) and every " +
          "role-level edge (reportsTo/alignsWith), as JSON.",
      },
    },
    async () => toOrgGraphDto(app.orgGraphStore.current),
  );
}
