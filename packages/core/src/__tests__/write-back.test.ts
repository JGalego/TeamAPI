import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { formatSlackUsergroupPlan, planSlackUsergroups, usergroupHandle } from "../apply/slack-usergroups";
import { formatOktaGroupPlan, planOktaGroups } from "../apply/okta-groups";
import { formatPagerDutyTeamPlan, normaliseTeamName, planPagerDutyTeams } from "../apply/pagerduty-teams";
import type { OrgGraph } from "../model/org-graph";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;
/** Every declared address in the org, so a fixture can stand in for "the whole company is in this
 * system" without hard-coding names that a change to the example would silently invalidate. */
let addresses: string[];

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
  addresses = [...graph.teams.values()].flatMap((team) =>
    team.doc.members.map((member) => member.contact).filter((contact): contact is string => Boolean(contact)),
  );
});

const teamAddresses = (teamId: string): string[] =>
  graph.teams
    .get(teamId)!
    .doc.members.map((member) => member.contact)
    .filter((contact): contact is string => Boolean(contact));

describe("planSlackUsergroups", () => {
  const slackUsers = () => addresses.map((email, i) => ({ id: `U${i}`, email }));

  it("plans a create for a team with no usergroup", () => {
    const plan = planSlackUsergroups(graph, [], slackUsers());
    const checkout = plan.entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(checkout.action).toBe("create");
    expect(checkout.usersToAdd.map((user) => user.email).sort()).toEqual(teamAddresses("stream-checkout").sort());
    expect(formatSlackUsergroupPlan(plan)).toContain("+ create @stream-checkout");
  });

  it("plans nothing for a usergroup that already matches", () => {
    const users = slackUsers();
    const byEmail = new Map(users.map((user) => [user.email, user.id]));
    const usergroups = [...graph.teams.keys()].map((teamId) => ({
      id: `S-${teamId}`,
      handle: teamId,
      name: teamId,
      userIds: teamAddresses(teamId).map((email) => byEmail.get(email)!),
    }));

    const plan = planSlackUsergroups(graph, usergroups, users);
    expect(plan.entries.every((entry) => entry.action === "noop")).toBe(true);
    expect(formatSlackUsergroupPlan(plan)).toContain("No changes.");
  });

  it("adds and removes against an existing group", () => {
    const users = [...slackUsers(), { id: "U-stranger", email: "stranger@example.com" }];
    const plan = planSlackUsergroups(
      graph,
      [{ id: "S1", handle: "stream-checkout", name: "Checkout", userIds: ["U-stranger"] }],
      users,
    );
    const checkout = plan.entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(checkout.action).toBe("update");
    expect(checkout.usersToRemove).toEqual(["U-stranger"]);
    expect(checkout.usersToAdd.length).toBeGreaterThan(0);
  });

  it("reports a member it could not resolve rather than guessing at one", () => {
    // A fuzzy name match that picks the wrong Ana is worse than a line in a report.
    const plan = planSlackUsergroups(graph, [], []);
    const checkout = plan.entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(checkout.unresolved.length).toBeGreaterThan(0);
    expect(checkout.action).toBe("noop");
    expect(formatSlackUsergroupPlan(plan)).toContain("no matching Slack account");
  });

  it("ignores deactivated accounts and bots when resolving addresses", () => {
    const [first, ...rest] = addresses;
    const users = [
      { id: "U-dead", email: first!, deleted: true },
      { id: "U-bot", email: "bot@example.com", isBot: true },
      ...rest.map((email, i) => ({ id: `U${i}`, email })),
    ];
    const plan = planSlackUsergroups(graph, [], users);
    expect(plan.entries.flatMap((entry) => entry.usersToAdd).map((user) => user.userId)).not.toContain("U-dead");
  });

  it("leaves a usergroup no team claims alone, and reports it", () => {
    const plan = planSlackUsergroups(
      graph,
      [{ id: "S9", handle: "social", name: "Social", userIds: [] }],
      slackUsers(),
    );
    expect(plan.unclaimed).toEqual(["social"]);
    expect(formatSlackUsergroupPlan(plan)).toContain("1 usergroup(s) no team claims");
  });

  it("prefixes handles when the workspace needs it", () => {
    // Slack handles are global; an org with an unrelated `payments` group needs a way not to
    // collide with it.
    expect(usergroupHandle("payments", "team-")).toBe("team-payments");
    const plan = planSlackUsergroups(graph, [], slackUsers(), { handlePrefix: "team-" });
    expect(plan.entries.every((entry) => entry.handle.startsWith("team-"))).toBe(true);
  });
});

describe("planOktaGroups", () => {
  it("plans membership changes against a matching group", () => {
    const plan = planOktaGroups(
      graph,
      [{ name: "stream-checkout", members: [{ email: "stranger@example.com", status: "ACTIVE" }] }],
      {},
    );
    const checkout = plan.entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(checkout.action).toBe("update");
    expect(checkout.toRemove).toEqual(["stranger@example.com"]);
    expect(checkout.toAdd.sort()).toEqual(
      teamAddresses("stream-checkout")
        .map((e) => e.toLowerCase())
        .sort(),
    );
  });

  it("never plans to create a group", () => {
    // A directory quietly acquiring a second grouping scheme nobody governs is a worse outcome
    // than a line in a report.
    const plan = planOktaGroups(graph, [], {});
    expect(plan.entries.every((entry) => entry.action === "missing")).toBe(true);
    expect(formatOktaGroupPlan(plan)).toContain("create it by hand");
  });

  it("does not plan to remove a deactivated account", () => {
    // Removing somebody from a group is a different operation from offboarding, usually owned by
    // somebody else; okta-drift is where that gets reported.
    const members = [
      ...teamAddresses("stream-checkout").map((email) => ({ email, status: "ACTIVE" })),
      { email: "gone@example.com", status: "DEPROVISIONED" },
    ];
    const plan = planOktaGroups(graph, [{ name: "stream-checkout", members }], {});
    const checkout = plan.entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(checkout.action).toBe("noop");
    expect(checkout.toRemove).toEqual([]);
  });

  it("strips the group prefix the same way okta-drift does", () => {
    const plan = planOktaGroups(graph, [{ name: "eng-stream-checkout", members: [] }], { groupPrefix: "eng-" });
    expect(plan.entries.find((entry) => entry.teamId === "stream-checkout")!.groupName).toBe("eng-stream-checkout");
  });

  it("reports a member with no contact address", () => {
    const plan = planOktaGroups(graph, [{ name: "stream-checkout", members: [] }], {});
    const rendered = formatOktaGroupPlan(plan);
    expect(rendered).toContain("+ add");
  });
});

describe("planPagerDutyTeams", () => {
  const pdUsers = () => addresses.map((email, i) => ({ id: `P${i}`, email }));

  it("matches a PagerDuty team by id or by display name", () => {
    // An org that named its PagerDuty teams before it had team ids should not have to rename them.
    const byName = planPagerDutyTeams(
      graph,
      [{ id: "PD1", name: "Stream Checkout", members: [] }],
      pdUsers(),
    ).entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(byName.pagerDutyTeamId).toBe("PD1");

    const byId = planPagerDutyTeams(
      graph,
      [{ id: "PD2", name: "stream_checkout", members: [] }],
      pdUsers(),
    ).entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(byId.pagerDutyTeamId).toBe("PD2");
    expect(normaliseTeamName("Stream Checkout")).toBe(normaliseTeamName("stream-checkout"));
  });

  it("never plans to create a team", () => {
    // A PagerDuty team created by a sync has no escalation policies, and looks exactly like one
    // whose policies were deleted.
    const plan = planPagerDutyTeams(graph, [], pdUsers());
    expect(plan.entries.every((entry) => entry.action === "missing")).toBe(true);
    expect(formatPagerDutyTeamPlan(plan)).toContain("create it by hand");
  });

  it("says in the plan that schedules are never written", () => {
    // The single most important thing about this command, printed every time rather than left in
    // the docs: a schedule rewritten from a structural document reverts a 2am override silently.
    expect(formatPagerDutyTeamPlan(planPagerDutyTeams(graph, [], pdUsers()))).toContain(
      "Schedules and escalation policies are never written",
    );
  });

  it("adds and removes members against a matched team", () => {
    const users = [...pdUsers(), { id: "P-stranger", email: "stranger@example.com" }];
    const plan = planPagerDutyTeams(
      graph,
      [{ id: "PD1", name: "stream-checkout", members: [{ id: "P-stranger", email: "stranger@example.com" }] }],
      users,
    );
    const checkout = plan.entries.find((entry) => entry.teamId === "stream-checkout")!;
    expect(checkout.action).toBe("update");
    expect(checkout.toRemove.map((user) => user.email)).toEqual(["stranger@example.com"]);
    expect(checkout.toAdd.length).toBeGreaterThan(0);
  });

  it("leaves a PagerDuty team no team claims alone", () => {
    const plan = planPagerDutyTeams(graph, [{ id: "PD9", name: "Security", members: [] }], pdUsers());
    expect(plan.unclaimed).toEqual(["Security"]);
  });
});
