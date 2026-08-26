import * as fs from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import {
  analyzeProposalScenario,
  buildScenarioDiagram,
  buildTeamProposal,
  getTeam,
  GithubClient,
  openTeamProposal,
  ProposalError,
  scoreProposalImpact,
  toMermaid,
  type ProposalRepo,
} from "@jgalego/teamapi-core";
import { errorResponseSchema } from "../schemas/error";

export interface ProposalRouteOptions {
  repo: ProposalRepo;
  /** GitHub token with write access to the repository. Never read from a config file. */
  token: string;
}

/**
 * `POST /teams/:id/proposals` — the one write path, and it writes to a pull request.
 *
 * Everything else in this API is read-only because the YAML documents in git are the source of
 * truth, and that is worth keeping. But "keep it in git" has been, in practice, "only engineers
 * may correct their team's own description", and the result is documents that are wrong in ways
 * everybody knows about and nobody with the wrong job title can fix.
 *
 * A proposal does not change the served graph. It opens a pull request against the repository the
 * documents came from: reviewed, attributable, CI-checked, declinable. Every property that makes
 * git-as-source-of-truth worth having survives; the only thing that changes is who can start the
 * conversation.
 *
 * Mounted only when the server was given a repository and a token, because a write path nobody
 * asked for is a write path nobody is watching.
 */
export async function proposalRoutes(app: FastifyInstance, options: ProposalRouteOptions): Promise<void> {
  const client = new GithubClient({ token: options.token });

  app.post<{ Params: { id: string }; Body: { patch?: unknown } }>(
    "/teams/:id/proposals/analyze",
    {
      schema: {
        tags: ["Proposals"],
        summary: "Preview a proposal's organizational impact",
        description:
          "Applies the patch to an immutable graph overlay and returns an explainable risk score, graph diff, " +
          "accountability and policy changes, and a Mermaid impact diagram. Does not write to GitHub.",
        params: {
          type: "object",
          properties: { id: { type: "string", description: "Team id (slug)" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: { patch: { type: "object", description: "The fields to simulate" } },
          required: ["patch"],
        },
        response: { 400: errorResponseSchema, 404: errorResponseSchema },
      },
    },
    async (req, reply) => {
      try {
        const scenario = analyzeProposalScenario(app.orgGraphStore.current, req.params.id, req.body?.patch);
        const score = scoreProposalImpact(scenario);
        return {
          teamId: scenario.teamId,
          score,
          diff: scenario.diff,
          gaps: scenario.gaps,
          policies: scenario.policies,
          before: scenario.before,
          after: scenario.after,
          diagram: toMermaid(buildScenarioDiagram(scenario, score)),
        };
      } catch (err) {
        if (err instanceof ProposalError) {
          const status = err.message.startsWith("Unknown team") ? 404 : 400;
          return reply.code(status).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { patch?: unknown; author?: string; dryRun?: boolean } }>(
    "/teams/:id/proposals",
    {
      schema: {
        tags: ["Proposals"],
        summary: "Propose a change to a team, as a pull request",
        description:
          "Applies a small, validated patch to the team's document and opens a pull request carrying it. " +
          "Only info.name, info.focus, cognitiveLoad, channels and searchTerms may be changed — nothing that " +
          "alters what other documents resolve to. The result is re-validated and re-formatted before it is " +
          "pushed, so the pull request cannot fail `teamapi validate` or `teamapi fmt --check`. " +
          "With dryRun, returns the proposed file and change summary without writing anything.",
        params: {
          type: "object",
          properties: { id: { type: "string", description: "Team id (slug)" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            patch: { type: "object", description: "The fields to change" },
            author: { type: "string", description: "Who to credit in the pull request body" },
            dryRun: {
              type: "boolean",
              description: "Compute the change without opening a pull request",
              default: false,
            },
          },
          required: ["patch"],
        },
        response: { 400: errorResponseSchema, 404: errorResponseSchema, 502: errorResponseSchema },
      },
    },
    async (req, reply) => {
      const team = getTeam(app.orgGraphStore.current, req.params.id);
      if (!team) return reply.code(404).send({ error: `Unknown team id '${req.params.id}'` });

      let proposal;
      try {
        // Read from disk rather than re-serializing the resolved document, so the file's comments —
        // which carry the reasons the numbers are what they are — survive the round trip.
        const original = await fs.readFile(team.sourceUri, "utf-8");
        proposal = buildTeamProposal(team, req.body?.patch, original);
      } catch (err) {
        if (err instanceof ProposalError) return reply.code(400).send({ error: err.message });
        throw err;
      }

      if (req.body?.dryRun) {
        return { teamId: proposal.teamId, summary: proposal.summary, content: proposal.content, dryRun: true };
      }

      try {
        const opened = await openTeamProposal(client, proposal, options.repo, req.body?.author);
        return await reply.code(201).send({ ...opened, teamId: proposal.teamId, summary: proposal.summary });
      } catch (err) {
        // 502, not 500: the request was fine and this server worked; GitHub is what refused. A 500
        // would send somebody to read these logs instead of the API response that names the cause.
        return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
