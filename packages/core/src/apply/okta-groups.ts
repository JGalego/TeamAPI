import type { DirectoryGroup } from "./okta-drift";
import type { OrgGraph, TeamId } from "../model/org-graph";

export interface OktaGroupPlanEntry {
  teamId: TeamId;
  groupName: string;
  action: "update" | "noop" | "missing";
  /** Addresses to add to / remove from the group. */
  toAdd: string[];
  toRemove: string[];
  /** Declared members with no `contact`, which is the only thing a directory can match on. */
  unresolved: string[];
}

export interface OktaGroupPlan {
  entries: OktaGroupPlanEntry[];
  /** Directory groups no team claims. Reported, never touched. */
  unclaimed: string[];
}

/**
 * Diffs each team's declared members against its directory group.
 *
 * `okta-drift` reports this and stops. Reporting is the right default — a directory group is
 * frequently load-bearing for access, and a tool that silently rewrote one would be a security
 * incident waiting to be written up — but "report only" also means every drift it finds is fixed
 * by hand, in a UI, one person at a time, which is why the drift is there in the first place.
 *
 * So: same diff, behind a plan and an explicit `--yes`.
 *
 * Groups are **never created and never deleted**, only their membership changed, and that is a
 * deliberate asymmetry. A missing group is reported, because creating one is how a directory
 * quietly acquires a second grouping scheme nobody governs; and deleting a group can revoke access
 * to everything mapped onto it, which no static document should be able to do as a side effect.
 */
export function planOktaGroups(
  graph: OrgGraph,
  groups: DirectoryGroup[],
  options: { groupPrefix?: string } = {},
): OktaGroupPlan {
  const prefix = options.groupPrefix ?? "";
  const byTeam = new Map<string, DirectoryGroup>();
  for (const group of groups) {
    const bare = prefix && group.name.startsWith(prefix) ? group.name.slice(prefix.length) : group.name;
    byTeam.set(bare, group);
  }

  const entries: OktaGroupPlanEntry[] = [];
  const claimed = new Set<string>();

  for (const teamId of [...graph.teams.keys()].sort()) {
    const group = byTeam.get(teamId);
    const desired = new Set<string>();
    const unresolved: string[] = [];
    for (const member of graph.teams.get(teamId)!.doc.members) {
      if (member.contact) desired.add(member.contact.toLowerCase());
      else unresolved.push(member.id);
    }

    if (!group) {
      entries.push({
        teamId,
        groupName: `${prefix}${teamId}`,
        action: "missing",
        toAdd: [...desired].sort(),
        toRemove: [],
        unresolved,
      });
      continue;
    }
    claimed.add(group.name);

    // Deactivated accounts are not "to remove": they are already not in use, and removing them
    // from a group is a different operation from offboarding, usually owned by somebody else.
    // `okta-drift` reports them, which is where that belongs.
    const active = group.members.filter((member) => (member.status ?? "ACTIVE").toUpperCase() === "ACTIVE");
    const current = new Set(active.map((member) => member.email.toLowerCase()));

    const toAdd = [...desired].filter((email) => !current.has(email)).sort();
    const toRemove = [...current].filter((email) => !desired.has(email)).sort();

    entries.push({
      teamId,
      groupName: group.name,
      action: toAdd.length > 0 || toRemove.length > 0 ? "update" : "noop",
      toAdd,
      toRemove,
      unresolved,
    });
  }

  return {
    entries,
    unclaimed: groups
      .map((group) => group.name)
      .filter((name) => !claimed.has(name))
      .sort(),
  };
}

export function formatOktaGroupPlan(plan: OktaGroupPlan): string {
  const lines: string[] = [];
  let changes = 0;

  for (const entry of plan.entries) {
    if (entry.action === "missing") {
      lines.push(`! no directory group '${entry.groupName}' for team '${entry.teamId}' — create it by hand`);
      continue;
    }
    for (const email of entry.toAdd) {
      changes++;
      lines.push(`  + add ${email} to ${entry.groupName}`);
    }
    for (const email of entry.toRemove) {
      changes++;
      lines.push(`  - remove ${email} from ${entry.groupName}`);
    }
    if (entry.unresolved.length > 0) {
      lines.push(
        `  ! ${entry.groupName}: ${entry.unresolved.length} member(s) with no contact address: ${entry.unresolved.join(", ")}`,
      );
    }
  }

  if (plan.unclaimed.length > 0) {
    lines.push(`  ${plan.unclaimed.length} group(s) no team claims, left alone`);
  }
  if (changes === 0) lines.unshift("No changes. Directory groups already match the org graph.");
  return lines.join("\n");
}
