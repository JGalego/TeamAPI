import type { FastifyInstance } from "fastify";
import { planGaps } from "@jgalego/teamapi-core";

export async function gapsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/gaps",
    {
      schema: {
        tags: ["Gaps"],
        summary: "Accountability holes between teams",
        description:
          "Findings that are invisible from any single teamapi.yml and only appear once the graph is " +
          "resolved: subscriptions to events nothing publishes, agents whose ownerId names nobody, vacant " +
          "roles other teams report into, one-sided collaborations, and unscored agent-supervision load. " +
          "Also reports how many cross-team role relationships the reporting hierarchy actually explains. " +
          "Read-only and computed on demand, like /cognitive-load.",
      },
    },
    async () => {
      return planGaps(app.orgGraphStore.current);
    },
  );
}
