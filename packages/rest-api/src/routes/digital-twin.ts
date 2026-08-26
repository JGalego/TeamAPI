import type { FastifyInstance } from "fastify";
import { buildDigitalTwinScene } from "@jgalego/teamapi-core";

export async function digitalTwinRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/digital-twin",
    {
      schema: {
        tags: ["Digital Twin"],
        summary: "Get a replayable organization scene",
        description:
          "Returns teams, people, agents, relationships, and deterministic visualization events. Events describe the graph; they do not claim that work is executing live.",
      },
    },
    async () => buildDigitalTwinScene(app.orgGraphStore.current),
  );
}
