import type { OrgGraph, TeamId } from "../model/org-graph";

/** The subset of a Slack `usergroups.list` entry this planner needs. */
export interface SlackUsergroup {
  id: string;
  handle: string;
  name: string;
  /** Slack user ids currently in the group. */
  userIds: string[];
}

/** A Slack workspace member, as `users.list` returns them. */
export interface SlackUser {
  id: string;
  email?: string;
  deleted?: boolean;
  isBot?: boolean;
}

export interface UsergroupPlanEntry {
  teamId: TeamId;
  handle: string;
  action: "create" | "update" | "noop";
  /** Slack user ids to add / remove, with the address that resolved to each, so the plan reads as
   * people rather than as `U024BE7LH`. */
  usersToAdd: Array<{ userId: string; email: string }>;
  usersToRemove: string[];
  /** Declared members whose `contact` matched no active Slack account. */
  unresolved: string[];
}

export interface SlackUsergroupPlan {
  entries: UsergroupPlanEntry[];
  /** Usergroups no team claims. Reported, never touched — plenty of usergroups are not teams. */
  unclaimed: string[];
}

/** Team id, prefixed if the workspace uses one. Slack handles are global, and an org that already
 * has a `payments` usergroup for something else needs a way not to collide with it. */
export function usergroupHandle(teamId: TeamId, prefix = ""): string {
  return `${prefix}${teamId}`;
}

/**
 * Diffs each team's declared members against the Slack usergroup that represents it.
 *
 * This is the write-back that pays for itself. `@platform-payments` in a Slack message is how
 * people actually reach a team, and it is maintained by hand — which means it is wrong within
 * weeks of anybody joining or leaving, silently, in the one place where being wrong means the
 * message reaches nobody.
 *
 * Members are matched to Slack accounts by email, because that is the only field both systems
 * reliably carry. A declared member with no `contact`, or whose address matches no active account,
 * is reported as unresolved rather than guessed at: a fuzzy name match that picks the wrong Ana is
 * worse than a line in a report.
 */
export function planSlackUsergroups(
  graph: OrgGraph,
  usergroups: SlackUsergroup[],
  users: SlackUser[],
  options: { handlePrefix?: string } = {},
): SlackUsergroupPlan {
  const prefix = options.handlePrefix ?? "";
  const byEmail = new Map(
    users
      .filter((user) => !user.deleted && !user.isBot && user.email)
      .map((user) => [user.email!.toLowerCase(), user.id]),
  );
  const byHandle = new Map(usergroups.map((group) => [group.handle, group]));

  const entries: UsergroupPlanEntry[] = [];
  const claimed = new Set<string>();

  for (const teamId of [...graph.teams.keys()].sort()) {
    const handle = usergroupHandle(teamId, prefix);
    claimed.add(handle);

    const desired = new Map<string, string>();
    const unresolved: string[] = [];
    for (const member of graph.teams.get(teamId)!.doc.members) {
      const userId = member.contact ? byEmail.get(member.contact.toLowerCase()) : undefined;
      if (userId) desired.set(userId, member.contact!);
      else unresolved.push(member.id);
    }

    const existing = byHandle.get(handle);
    if (!existing) {
      entries.push({
        teamId,
        handle,
        // A team with nobody resolvable would create an empty usergroup, which Slack rejects and
        // which would be useless anyway.
        action: desired.size > 0 ? "create" : "noop",
        usersToAdd: [...desired]
          .map(([userId, email]) => ({ userId, email }))
          .sort((a, b) => a.email.localeCompare(b.email)),
        usersToRemove: [],
        unresolved,
      });
      continue;
    }

    const current = new Set(existing.userIds);
    const usersToAdd = [...desired]
      .filter(([userId]) => !current.has(userId))
      .map(([userId, email]) => ({ userId, email }))
      .sort((a, b) => a.email.localeCompare(b.email));
    const usersToRemove = [...current].filter((userId) => !desired.has(userId)).sort();

    entries.push({
      teamId,
      handle,
      action: usersToAdd.length > 0 || usersToRemove.length > 0 ? "update" : "noop",
      usersToAdd,
      usersToRemove,
      unresolved,
    });
  }

  return {
    entries,
    unclaimed: usergroups
      .map((group) => group.handle)
      .filter((handle) => !claimed.has(handle))
      .sort(),
  };
}

/** `terraform plan`-style rendering, matching `formatApplyPlan`'s shape. */
export function formatSlackUsergroupPlan(plan: SlackUsergroupPlan): string {
  const lines: string[] = [];
  let changes = 0;

  for (const entry of plan.entries) {
    if (entry.action === "create") {
      lines.push(`+ create @${entry.handle} (${entry.teamId})`);
      changes++;
    }
    for (const { email } of entry.usersToAdd) {
      if (entry.action !== "create") changes++;
      lines.push(`  + add ${email} to @${entry.handle}`);
    }
    for (const userId of entry.usersToRemove) {
      changes++;
      lines.push(`  - remove ${userId} from @${entry.handle}`);
    }
    if (entry.unresolved.length > 0) {
      lines.push(
        `  ! @${entry.handle}: ${entry.unresolved.length} member(s) with no matching Slack account: ${entry.unresolved.join(", ")}`,
      );
    }
  }

  if (plan.unclaimed.length > 0) {
    lines.push(`  ${plan.unclaimed.length} usergroup(s) no team claims, left alone`);
  }
  if (changes === 0) lines.unshift("No changes. Slack usergroups already match the org graph.");
  return lines.join("\n");
}
