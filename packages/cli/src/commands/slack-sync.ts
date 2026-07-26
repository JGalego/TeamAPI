import { buildOrgGraph, formatSlackPlan, planSlackSync, SlackClient } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface SlackSyncOptions {
  token?: string;
  yes?: boolean;
}

/**
 * Sets each declared Slack channel's topic to name the team that owns it and what they own.
 *
 * Same plan/apply split as `teamapi apply`: this writes to a system outside the repo, so it
 * prints what it would do and stops unless `--yes` is passed. Only topics are touched — creating
 * channels or moving people between them is not something a spec file should be doing quietly.
 */
export async function runSlackSync(patterns: string[], options: SlackSyncOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const token = options.token ?? process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error("A Slack bot token is required: pass --token or set SLACK_BOT_TOKEN.");
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  const client = new SlackClient({ token });

  let plan;
  let channels;
  try {
    channels = await client.listChannels();
    plan = planSlackSync(graph, channels);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  console.log(formatSlackPlan(plan));

  const updates = plan.entries.filter((entry) => entry.action === "update");
  if (updates.length === 0) return 0;

  if (!options.yes) {
    console.log("\nRe-run with --yes to apply this plan.");
    return 0;
  }

  try {
    const byName = new Map(channels.map((c) => [c.name, c]));
    for (const entry of updates) {
      const channel = byName.get(entry.channel);
      if (!channel) continue;
      await client.setTopic(channel.id, entry.desiredTopic);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  console.log("\nApplied.");
  return 0;
}
