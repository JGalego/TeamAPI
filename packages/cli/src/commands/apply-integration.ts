import {
  buildOrgGraph,
  formatOktaGroupPlan,
  formatPagerDutyTeamPlan,
  formatSlackUsergroupPlan,
  OktaClient,
  PagerDutyClient,
  planOktaGroups,
  planPagerDutyTeams,
  planSlackUsergroups,
  SlackClient,
} from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { isConfigFailure, resolveInput, type ConfigAwareOptions } from "../with-config";

export const APPLY_TARGETS = ["slack", "okta", "pagerduty"] as const;
export type ApplyTarget = (typeof APPLY_TARGETS)[number];

export interface ApplyIntegrationOptions extends ConfigAwareOptions {
  token?: string;
  /** Okta org URL. */
  url?: string;
  /** Strip/prepend this on group or usergroup names. */
  prefix?: string;
  /** Execute the plan instead of only printing it. */
  yes?: boolean;
}

/** One plan, its rendering, and the writes that execute it. Returned by each target's planner so
 * `runApplyIntegration` below is the same nine lines whichever target was named. */
interface PreparedPlan {
  rendered: string;
  changes: number;
  execute: () => Promise<void>;
}

const TOKEN_ENV: Record<ApplyTarget, string> = {
  slack: "SLACK_BOT_TOKEN",
  okta: "OKTA_TOKEN",
  pagerduty: "PAGERDUTY_TOKEN",
};

async function prepareSlack(
  graph: Awaited<ReturnType<typeof buildOrgGraph>>,
  token: string,
  prefix: string | undefined,
): Promise<PreparedPlan> {
  const client = new SlackClient({ token });
  const [usergroups, users] = await Promise.all([client.listUsergroups(), client.listUsers()]);
  const plan = planSlackUsergroups(graph, usergroups, users, { handlePrefix: prefix });
  const actionable = plan.entries.filter((entry) => entry.action !== "noop");

  return {
    rendered: formatSlackUsergroupPlan(plan),
    changes: actionable.length,
    execute: async () => {
      const byHandle = new Map(usergroups.map((group) => [group.handle, group]));
      for (const entry of actionable) {
        // Slack has no add-one/remove-one endpoint for usergroup membership, so the desired set is
        // computed here and sent whole. Derived from the plan rather than re-read, so what is
        // written is exactly what was shown.
        const existing = byHandle.get(entry.handle);
        const desired = new Set(existing ? existing.userIds : []);
        for (const userId of entry.usersToRemove) desired.delete(userId);
        for (const { userId } of entry.usersToAdd) desired.add(userId);

        const id =
          existing?.id ?? (await client.createUsergroup(entry.handle, graph.teams.get(entry.teamId)!.doc.info.name));
        await client.setUsergroupUsers(id, [...desired]);
      }
    },
  };
}

async function prepareOkta(
  graph: Awaited<ReturnType<typeof buildOrgGraph>>,
  token: string,
  url: string,
  prefix: string | undefined,
): Promise<PreparedPlan> {
  const client = new OktaClient({ token, url });
  const groups = await client.listGroups();
  const plan = planOktaGroups(graph, groups, { groupPrefix: prefix });
  const actionable = plan.entries.filter((entry) => entry.action === "update");

  return {
    rendered: formatOktaGroupPlan(plan),
    changes: actionable.length,
    execute: async () => {
      const groupIds = await client.listGroupIds();
      for (const entry of actionable) {
        const groupId = groupIds.get(entry.groupName);
        if (!groupId) continue;
        for (const email of entry.toAdd) {
          const userId = await client.findUserIdByEmail(email);
          // A declared member with no directory account is a fact about the org, not a failure of
          // this command — skipped, having already been visible in the plan.
          if (userId) await client.addUserToGroup(groupId, userId);
        }
        for (const email of entry.toRemove) {
          const userId = await client.findUserIdByEmail(email);
          if (userId) await client.removeUserFromGroup(groupId, userId);
        }
      }
    },
  };
}

async function preparePagerDuty(
  graph: Awaited<ReturnType<typeof buildOrgGraph>>,
  token: string,
  url: string | undefined,
): Promise<PreparedPlan> {
  const client = new PagerDutyClient({ token, ...(url ? { baseUrl: url } : {}) });
  const [teams, users] = await Promise.all([client.listTeams(), client.listUsers()]);
  const plan = planPagerDutyTeams(graph, teams, users);
  const actionable = plan.entries.filter((entry) => entry.action === "update");

  return {
    rendered: formatPagerDutyTeamPlan(plan),
    changes: actionable.length,
    execute: async () => {
      for (const entry of actionable) {
        if (!entry.pagerDutyTeamId) continue;
        for (const { userId } of entry.toAdd) await client.addUserToTeam(entry.pagerDutyTeamId, userId);
        for (const { userId } of entry.toRemove) await client.removeUserFromTeam(entry.pagerDutyTeamId, userId);
      }
    },
  };
}

/**
 * Reconciles membership in a system other than GitHub with the org graph.
 *
 * `apply` has always written to GitHub teams; Slack, Okta and PagerDuty were read-only drift
 * reports. Reporting is the right default and it is also how the drift got there: every finding
 * was fixed by hand, in a UI, one person at a time, which nobody keeps up with.
 *
 * Same plan-then-`--yes` shape as `apply`, and the same restraint about what is *not* written.
 * Nothing here creates a directory group or a PagerDuty team, and nothing touches a schedule — see
 * each planner for why.
 */
export async function runApplyIntegration(
  target: ApplyTarget,
  patterns: string[],
  options: ApplyIntegrationOptions,
): Promise<number> {
  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) {
    console.error(input.error);
    return 1;
  }

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${input.patterns.join(", ")}`);
    return 1;
  }

  const token = options.token ?? process.env[TOKEN_ENV[target]];
  if (!token) {
    console.error(`A token is required for '${target}': pass --token or set ${TOKEN_ENV[target]}.`);
    return 1;
  }

  const graph = await buildOrgGraph(resolveOptions(seeds));
  warnUnresolved(graph);

  let prepared: PreparedPlan;
  try {
    if (target === "slack") {
      prepared = await prepareSlack(graph, token, options.prefix);
    } else if (target === "okta") {
      const url = options.url ?? input.config.defaults.okta.url;
      if (!url) {
        console.error("An Okta org URL is required: pass --url or set defaults.okta.url in teamapi.config.yml.");
        return 1;
      }
      prepared = await prepareOkta(graph, token, url, options.prefix ?? input.config.defaults.okta.groupPrefix);
    } else {
      prepared = await preparePagerDuty(graph, token, options.url ?? input.config.defaults.pagerduty.url);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  console.log(prepared.rendered);
  if (prepared.changes === 0) return 0;

  if (!options.yes) {
    console.log("\nRe-run with --yes to apply this plan.");
    return 0;
  }

  try {
    await prepared.execute();
  } catch (err) {
    // Partially applied, and said so: these APIs have no transaction, so a failure halfway
    // through has already changed things. Re-running produces a plan of whatever is left, which
    // is the only honest recovery.
    console.error(`\nFailed partway through: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Some changes may already have been applied. Re-run to see what remains.");
    return 1;
  }

  console.log("\nApplied.");
  return 0;
}
