import * as crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { findServiceOwner } from "@jgalego/teamapi-core";

/** Slack signs the string `v0:<timestamp>:<raw body>` with the app's signing secret. */
export function slackSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
}

/** Slack's own guidance: reject anything older than five minutes, so a captured request can't be
 * replayed later. Compared in constant time, since a fast reject leaks the prefix. */
export function verifySlackRequest(
  secret: string,
  signature: string | undefined,
  timestamp: string | undefined,
  rawBody: string,
  nowSeconds: number,
): boolean {
  if (!signature || !timestamp) return false;
  const age = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = Buffer.from(slackSignature(secret, timestamp, rawBody));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export interface SlackRoutesOptions {
  signingSecret: string;
}

function reply(text: string): { response_type: "ephemeral"; text: string } {
  return { response_type: "ephemeral", text };
}

/**
 * A `/whoowns <service>` slash command over the same lookup the REST API and the MCP server use.
 *
 * This is the only part of TeamAPI that meets the question where it actually gets asked. Every
 * other surface assumes someone already decided to go and look something up.
 *
 * Registered only when a signing secret is configured, so an unauthenticated endpoint can never
 * exist by accident.
 */
export async function slackRoutes(app: FastifyInstance, options: SlackRoutesOptions): Promise<void> {
  // the HMAC covers the bytes Slack sent, so the raw body has to survive parsing
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  app.post(
    "/slack/whoowns",
    {
      schema: {
        tags: ["Slack"],
        summary: "Slack /whoowns slash command",
        description:
          "Answers 'who owns <service>?' in Slack. Requires a valid X-Slack-Signature, so it is " +
          "only mounted when a signing secret is configured.",
      },
    },
    async (req, res) => {
      const rawBody = typeof req.body === "string" ? req.body : "";
      const headers = req.headers as Record<string, string | undefined>;
      const ok = verifySlackRequest(
        options.signingSecret,
        headers["x-slack-signature"],
        headers["x-slack-request-timestamp"],
        rawBody,
        Math.floor(Date.now() / 1000),
      );
      if (!ok) return res.code(401).send({ error: "Bad Slack signature" });

      const query = new URLSearchParams(rawBody).get("text")?.trim() ?? "";
      if (!query) return reply("Usage: `/whoowns <service>` — for example `/whoowns checkout-api`.");

      const graph = app.orgGraphStore.current;
      const found = findServiceOwner(graph, query);
      if (!found) {
        const known = [...graph.teams.values()].flatMap((t) => t.doc.services.map((s) => s.name)).sort();
        return reply(
          known.length > 0
            ? `No service called \`${query}\`. Declared services: ${known.map((s) => `\`${s}\``).join(", ")}.`
            : `No service called \`${query}\`, and no team declares any services yet.`,
        );
      }

      const team = graph.teams.get(found.teamId)!.doc;
      const channel = team.channels.find((c) => c.type === "slack");
      const lines = [`\`${query}\` is owned by *${team.info.name}* (\`${found.teamId}\`).`];
      if (team.info.focus) lines.push(`_${team.info.focus}_`);
      if (channel) lines.push(`Ask in #${channel.name.replace(/^#/, "")}.`);
      return reply(lines.join("\n"));
    },
  );
}
