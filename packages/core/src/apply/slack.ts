import type { OrgGraph, TeamId } from "../model/org-graph";

/** The subset of a Slack `conversations.list` entry this planner needs. */
export interface SlackChannel {
  id: string;
  name: string;
  topic?: string;
}

export interface SlackChannelPlanEntry {
  channel: string;
  teamId: TeamId;
  /** `missing` means the team declares the channel but Slack has no such conversation. */
  action: "update" | "noop" | "missing";
  currentTopic?: string;
  desiredTopic: string;
}

export interface SlackSyncPlan {
  entries: SlackChannelPlanEntry[];
  /** A channel two teams both declare. Nothing is planned for it — see the note below. */
  conflicts: Array<{ channel: string; teamIds: TeamId[] }>;
  /** Slack channels no team claims. Reported, never touched: not every channel is a team's. */
  unclaimed: string[];
}

/**
 * The one line a channel topic can carry: who owns this, and what they own.
 *
 * Slack truncates topics around 250 characters, so services are listed until they no longer fit
 * rather than being cut mid-name.
 */
export function slackTopicFor(name: string, focus: string | undefined, services: string[]): string {
  const head = focus?.trim() ? `${name} — ${focus.trim()}` : name;
  if (services.length === 0) return head;

  let listed: string[] = [];
  for (const service of services) {
    const next = [...listed, service];
    if (`${head} · Owns: ${next.join(", ")}`.length > 250) break;
    listed = next;
  }
  if (listed.length === 0) return head;
  const suffix = listed.length < services.length ? `, +${services.length - listed.length} more` : "";
  return `${head} · Owns: ${listed.join(", ")}${suffix}`;
}

/**
 * Diffs each team's declared Slack `channels[]` against the real conversations in the workspace.
 *
 * Only topics are planned. Creating channels, inviting people and archiving are all deliberately
 * out of scope: a channel is a social object with history, and a spec file is the wrong thing to
 * be quietly reorganising one. Channels nobody declares are listed and left alone.
 *
 * A channel claimed by two teams is a conflict, not a merge — the same call made for CODEOWNERS,
 * for the same reason: the answer is a decision, not a default.
 */
export function planSlackSync(graph: OrgGraph, channels: SlackChannel[]): SlackSyncPlan {
  const byName = new Map(channels.map((c) => [c.name.replace(/^#/, ""), c]));
  const claimed = new Map<string, TeamId[]>();

  for (const teamId of [...graph.teams.keys()].sort()) {
    for (const channel of graph.teams.get(teamId)!.doc.channels) {
      if (channel.type !== "slack") continue;
      const name = channel.name.replace(/^#/, "");
      claimed.set(name, [...(claimed.get(name) ?? []), teamId]);
    }
  }

  const entries: SlackChannelPlanEntry[] = [];
  const conflicts: Array<{ channel: string; teamIds: TeamId[] }> = [];

  for (const [name, teamIds] of [...claimed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (teamIds.length > 1) {
      conflicts.push({ channel: name, teamIds: [...teamIds].sort() });
      continue;
    }
    const teamId = teamIds[0]!;
    const doc = graph.teams.get(teamId)!.doc;
    const desiredTopic = slackTopicFor(
      doc.info.name,
      doc.info.focus,
      doc.services.map((s) => s.name),
    );
    const existing = byName.get(name);

    if (!existing) {
      entries.push({ channel: name, teamId, action: "missing", desiredTopic });
      continue;
    }
    entries.push({
      channel: name,
      teamId,
      action: existing.topic === desiredTopic ? "noop" : "update",
      currentTopic: existing.topic,
      desiredTopic,
    });
  }

  const unclaimed = [...byName.keys()].filter((name) => !claimed.has(name)).sort();
  return { entries, conflicts, unclaimed };
}

/** `terraform plan`-style rendering, matching `formatApplyPlan`'s shape. */
export function formatSlackPlan(plan: SlackSyncPlan): string {
  const lines: string[] = [];
  let changes = 0;

  for (const entry of plan.entries) {
    if (entry.action === "noop") {
      lines.push(`  #${entry.channel}: up to date`);
      continue;
    }
    if (entry.action === "missing") {
      lines.push(`  #${entry.channel}: declared by ${entry.teamId}, no such channel in Slack`);
      continue;
    }
    changes++;
    lines.push(`~ #${entry.channel} (${entry.teamId})`);
    lines.push(`    - ${entry.currentTopic ?? "(no topic)"}`);
    lines.push(`    + ${entry.desiredTopic}`);
  }

  for (const conflict of plan.conflicts) {
    lines.push(`! #${conflict.channel} is claimed by ${conflict.teamIds.join(" and ")} — left alone`);
  }
  if (plan.unclaimed.length > 0) {
    lines.push(`  ${plan.unclaimed.length} channel(s) no team declares, left alone`);
  }

  lines.push("");
  lines.push(`${changes} topic(s) to update.`);
  return lines.join("\n");
}
