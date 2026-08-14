import type { OrgGraph, TeamId } from "../model/org-graph";

/** A PagerDuty team, with the users currently on it. */
export interface PagerDutyTeam {
  id: string;
  name: string;
  members: Array<{ id: string; email: string }>;
}

export interface PagerDutyUser {
  id: string;
  email: string;
}

export interface PagerDutyTeamPlanEntry {
  teamId: TeamId;
  pagerDutyTeamId?: string;
  pagerDutyTeamName: string;
  action: "update" | "noop" | "missing";
  toAdd: Array<{ userId: string; email: string }>;
  toRemove: Array<{ userId: string; email: string }>;
  /** Declared members whose `contact` matched no PagerDuty user. */
  unresolved: string[];
}

export interface PagerDutyTeamPlan {
  entries: PagerDutyTeamPlanEntry[];
  unclaimed: string[];
}

/** PagerDuty team names are display strings, so match them the same loose way service names are
 * matched: case, spaces, underscores and hyphens all collapse. */
export function normaliseTeamName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Diffs each team's declared members against its PagerDuty team's membership.
 *
 * **Team membership, not schedules, and that is the whole design.** A schedule is a statement
 * about time — who is on call this week, who swapped, who is on holiday — and a `teamapi.yml` is a
 * statement about structure. Generating one from the other means an override somebody arranged at
 * 2am gets reverted by CI at 9am, and the failure is silent until an incident pages nobody. Team
 * membership carries none of that: it is the same fact the org graph already holds, and getting it
 * wrong is why a service's escalation policy routinely reaches somebody who moved teams a quarter
 * ago.
 *
 * Teams are never created here either. A PagerDuty team is what escalation policies and services
 * are attached to, and one created by a sync is a team with no policies that looks exactly like
 * one whose policies were deleted.
 */
export function planPagerDutyTeams(graph: OrgGraph, teams: PagerDutyTeam[], users: PagerDutyUser[]): PagerDutyTeamPlan {
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user.id]));
  const byName = new Map(teams.map((team) => [normaliseTeamName(team.name), team]));

  const entries: PagerDutyTeamPlanEntry[] = [];
  const claimed = new Set<string>();

  for (const teamId of [...graph.teams.keys()].sort()) {
    const doc = graph.teams.get(teamId)!.doc;
    // Matched by id first, then by display name: an org that named its PagerDuty teams before it
    // had team ids should not have to rename them to adopt this.
    const target = byName.get(normaliseTeamName(teamId)) ?? byName.get(normaliseTeamName(doc.info.name));

    const desired = new Map<string, string>();
    const unresolved: string[] = [];
    for (const member of doc.members) {
      const userId = member.contact ? byEmail.get(member.contact.toLowerCase()) : undefined;
      if (userId) desired.set(userId, member.contact!);
      else unresolved.push(member.id);
    }

    if (!target) {
      entries.push({
        teamId,
        pagerDutyTeamName: doc.info.name,
        action: "missing",
        toAdd: [...desired].map(([userId, email]) => ({ userId, email })),
        toRemove: [],
        unresolved,
      });
      continue;
    }
    claimed.add(target.name);

    const current = new Map(target.members.map((member) => [member.id, member.email]));
    const toAdd = [...desired]
      .filter(([userId]) => !current.has(userId))
      .map(([userId, email]) => ({ userId, email }))
      .sort((a, b) => a.email.localeCompare(b.email));
    const toRemove = [...current]
      .filter(([userId]) => !desired.has(userId))
      .map(([userId, email]) => ({ userId, email }))
      .sort((a, b) => a.email.localeCompare(b.email));

    entries.push({
      teamId,
      pagerDutyTeamId: target.id,
      pagerDutyTeamName: target.name,
      action: toAdd.length > 0 || toRemove.length > 0 ? "update" : "noop",
      toAdd,
      toRemove,
      unresolved,
    });
  }

  return {
    entries,
    unclaimed: teams
      .map((team) => team.name)
      .filter((name) => !claimed.has(name))
      .sort(),
  };
}

export function formatPagerDutyTeamPlan(plan: PagerDutyTeamPlan): string {
  const lines: string[] = [];
  let changes = 0;

  for (const entry of plan.entries) {
    if (entry.action === "missing") {
      lines.push(`! no PagerDuty team matching '${entry.teamId}' — create it by hand, then re-run`);
      continue;
    }
    for (const { email } of entry.toAdd) {
      changes++;
      lines.push(`  + add ${email} to '${entry.pagerDutyTeamName}'`);
    }
    for (const { email } of entry.toRemove) {
      changes++;
      lines.push(`  - remove ${email} from '${entry.pagerDutyTeamName}'`);
    }
    if (entry.unresolved.length > 0) {
      lines.push(
        `  ! '${entry.pagerDutyTeamName}': ${entry.unresolved.length} member(s) with no matching PagerDuty user: ${entry.unresolved.join(", ")}`,
      );
    }
  }

  if (plan.unclaimed.length > 0) {
    lines.push(`  ${plan.unclaimed.length} PagerDuty team(s) no team claims, left alone`);
  }
  if (changes === 0) lines.unshift("No changes. PagerDuty team membership already matches the org graph.");
  lines.push("");
  lines.push("Schedules and escalation policies are never written. A schedule is a statement about time —");
  lines.push("who swapped, who is on holiday — and rewriting it from a structural document reverts the");
  lines.push("override somebody arranged at 2am, silently, until an incident pages nobody.");
  return lines.join("\n");
}
