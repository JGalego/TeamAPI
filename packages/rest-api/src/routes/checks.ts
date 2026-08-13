import type { FastifyInstance } from "fastify";
import { checkPolicies, checkTopology } from "@jgalego/teamapi-core";

/**
 * The two checks that had a CLI command but no HTTP route.
 *
 * `/gaps` was already served, on the argument that a check needing no credentials and no network
 * should be answerable to an assistant without anyone running a report first. Policy and topology
 * are the same shape — pure functions of the resolved graph — and were only unreachable because
 * they were written after the routes were.
 *
 * Both are computed on demand rather than cached: they are cheap, and a cached answer to "is this
 * org compliant right now" is worse than no answer.
 */
export async function checksRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/policy",
    {
      schema: {
        tags: ["Policy"],
        summary: "Declared policies checked against the org graph",
        description:
          "Every rule in every team's policies[], split into satisfied, violated, delegated to an " +
          "external enforcer named in enforcedBy, unenforced (nothing anywhere checks it), and " +
          "misconfigured. Uses the built-in evaluators only — thresholds and severities configured in " +
          "teamapi.config.yml are a CLI concern and are not applied here.",
      },
    },
    async () => checkPolicies(app.orgGraphStore.current),
  );

  app.get(
    "/topology",
    {
      schema: {
        tags: ["Topology"],
        summary: "Team Topologies design smells",
        description:
          "Collaborations past the duration they declared or with none at all, teams past the size at " +
          "which they hold shared context, teams in more concurrent collaborations than they can " +
          "sustain, platform teams depending on the teams they serve, and dependencies a team called " +
          "blocking. Uses the default thresholds.",
      },
    },
    async () => checkTopology(app.orgGraphStore.current),
  );
}
