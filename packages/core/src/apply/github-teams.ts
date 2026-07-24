import type { GithubClient } from "../github/client";
import type { OrgGraph, TeamId } from "../model/org-graph";

export interface TeamPlanEntry {
  teamId: TeamId;
  action: "create" | "update" | "noop";
  membersToAdd: string[];
  membersToRemove: string[];
  /** Member ids on this team with no `githubUsername` set — can't be reconciled either way. */
  membersSkipped: string[];
}

export interface OrgApplyPlan {
  org: string;
  teams: TeamPlanEntry[];
}

/**
 * Diffs the org graph's declared team membership (by `member.githubUsername`) against the real
 * GitHub teams in `org` — one GitHub team per Team API team, matched by slug === team id. A team
 * with no matching GitHub team is planned as a create (with every resolvable member to add); an
 * existing team is planned as an update/noop based on the login-set difference.
 */
export async function planGithubTeamsApply(
  graph: OrgGraph,
  client: Pick<GithubClient, "listOrgTeams" | "listTeamMembers">,
  org: string,
): Promise<OrgApplyPlan> {
  const existingTeams = await client.listOrgTeams(org);
  const existingBySlug = new Map(existingTeams.map((team) => [team.slug, team]));

  const teams: TeamPlanEntry[] = [];
  for (const teamId of [...graph.teams.keys()].sort()) {
    const team = graph.teams.get(teamId)!;
    const desired = new Set<string>();
    const membersSkipped: string[] = [];
    for (const member of team.doc.members) {
      if (member.githubUsername) desired.add(member.githubUsername.toLowerCase());
      else membersSkipped.push(member.id);
    }

    if (!existingBySlug.has(teamId)) {
      teams.push({
        teamId,
        action: "create",
        membersToAdd: [...desired].sort(),
        membersToRemove: [],
        membersSkipped,
      });
      continue;
    }

    const currentMembers = await client.listTeamMembers(org, teamId);
    const currentLogins = new Set(currentMembers.map((user) => user.login.toLowerCase()));
    const membersToAdd = [...desired].filter((login) => !currentLogins.has(login)).sort();
    const membersToRemove = [...currentLogins].filter((login) => !desired.has(login)).sort();

    teams.push({
      teamId,
      action: membersToAdd.length > 0 || membersToRemove.length > 0 ? "update" : "noop",
      membersToAdd,
      membersToRemove,
      membersSkipped,
    });
  }

  return { org, teams };
}

/** Human-readable, `terraform plan`-style rendering of an `OrgApplyPlan`. */
export function formatApplyPlan(plan: OrgApplyPlan): string {
  const lines: string[] = [];
  let changeCount = 0;

  for (const entry of plan.teams) {
    if (entry.action === "create") {
      lines.push(`+ create team '${entry.teamId}' in ${plan.org}`);
      changeCount++;
    }
    for (const login of entry.membersToAdd) {
      lines.push(`  + add @${login} to '${entry.teamId}'`);
      changeCount++;
    }
    for (const login of entry.membersToRemove) {
      lines.push(`  - remove @${login} from '${entry.teamId}'`);
      changeCount++;
    }
    if (entry.membersSkipped.length > 0) {
      lines.push(
        `  ! '${entry.teamId}': ${entry.membersSkipped.length} member(s) skipped, no githubUsername set: ${entry.membersSkipped.join(", ")}`,
      );
    }
  }

  if (changeCount === 0) {
    lines.unshift("No changes. GitHub teams already match the org graph.");
  }
  return lines.join("\n");
}

/** Executes an `OrgApplyPlan` computed by `planGithubTeamsApply`, in place, against real GitHub
 * teams. Callers should show `formatApplyPlan(plan)` and get confirmation (e.g. a `--yes` flag)
 * before calling this — there's no dry-run inside it. */
export async function executeGithubTeamsApply(
  plan: OrgApplyPlan,
  graph: OrgGraph,
  client: Pick<GithubClient, "createTeam" | "setTeamMembership" | "removeTeamMembership">,
): Promise<void> {
  for (const entry of plan.teams) {
    if (entry.action === "create") {
      const team = graph.teams.get(entry.teamId)!;
      await client.createTeam(plan.org, { slug: entry.teamId, description: team.doc.info.focus });
    }
    for (const login of entry.membersToAdd) {
      await client.setTeamMembership(plan.org, entry.teamId, login);
    }
    for (const login of entry.membersToRemove) {
      await client.removeTeamMembership(plan.org, entry.teamId, login);
    }
  }
}
