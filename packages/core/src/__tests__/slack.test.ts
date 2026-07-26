import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { formatSlackPlan, planSlackSync, slackTopicFor, type SlackChannel } from "../apply/slack";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

const acme = () => buildOrgGraph({ seedUris: [CHECKOUT_SEED] });

/** The four channels examples/acme-org declares, as Slack would report them. */
const live = (overrides: Partial<Record<string, string | undefined>> = {}): SlackChannel[] =>
  ["stream-checkout", "platform-payments", "stream-onboarding", "enabling-devex"].map((name, i) => ({
    id: `C${i}`,
    name,
    topic: overrides[name],
  }));

describe("slackTopicFor", () => {
  it("names the team, its focus and what it owns", () => {
    expect(slackTopicFor("Stream Checkout", "Cart and checkout", ["checkout-api"])).toBe(
      "Stream Checkout — Cart and checkout · Owns: checkout-api",
    );
  });

  it("drops the focus when there isn't one, and the list when nothing is owned", () => {
    expect(slackTopicFor("Enabling DevEx", undefined, [])).toBe("Enabling DevEx");
    expect(slackTopicFor("Enabling DevEx", "  ", ["a"])).toBe("Enabling DevEx · Owns: a");
  });

  it("stops at Slack's topic limit on a service boundary rather than mid-name", () => {
    const many = Array.from({ length: 40 }, (_, i) => `service-with-a-long-name-${i}`);
    const topic = slackTopicFor("Platform", "Focus", many);

    expect(topic.length).toBeLessThanOrEqual(250 + " more".length + 4);
    expect(topic).toMatch(/, \+\d+ more$/);
    // whatever was listed is a whole name, never a truncated one
    const listed = topic.slice(topic.indexOf("Owns: ") + 6).replace(/, \+\d+ more$/, "").split(", ");
    for (const name of listed) expect(many).toContain(name);
  });
});

describe("planSlackSync — examples/acme-org", () => {
  it("plans an update for every channel whose topic doesn't match", async () => {
    const plan = planSlackSync(await acme(), live());
    expect(plan.entries.map((e) => `${e.channel}:${e.action}`)).toEqual([
      "enabling-devex:update",
      "platform-payments:update",
      "stream-checkout:update",
      "stream-onboarding:update",
    ]);
  });

  it("is a noop once a topic already says the right thing", async () => {
    const graph = await acme();
    const desired = planSlackSync(graph, live()).entries.find((e) => e.channel === "stream-checkout")!.desiredTopic;

    const plan = planSlackSync(graph, live({ "stream-checkout": desired }));
    expect(plan.entries.find((e) => e.channel === "stream-checkout")!.action).toBe("noop");
  });

  it("reports a declared channel that doesn't exist in the workspace", async () => {
    const plan = planSlackSync(await acme(), live().filter((c) => c.name !== "stream-checkout"));
    expect(plan.entries.find((e) => e.channel === "stream-checkout")).toMatchObject({
      action: "missing",
      teamId: "stream-checkout",
    });
  });

  it("leaves channels no team declares alone", async () => {
    const plan = planSlackSync(await acme(), [...live(), { id: "CX", name: "random-watercooler" }]);
    expect(plan.unclaimed).toEqual(["random-watercooler"]);
    expect(plan.entries.some((e) => e.channel === "random-watercooler")).toBe(false);
  });

  it("refuses to pick a side when two teams claim one channel", async () => {
    const graph = await acme();
    graph.teams.get("platform-payments")!.doc.channels.push({ type: "slack", name: "stream-checkout" });

    const plan = planSlackSync(graph, live());
    expect(plan.conflicts).toEqual([
      { channel: "stream-checkout", teamIds: ["platform-payments", "stream-checkout"] },
    ]);
    expect(plan.entries.some((e) => e.channel === "stream-checkout")).toBe(false);
  });

  it("ignores channels that aren't Slack", async () => {
    const graph = await acme();
    graph.teams.get("stream-checkout")!.doc.channels.push({ type: "teams", name: "not-slack" });

    const plan = planSlackSync(graph, live());
    expect(plan.entries.some((e) => e.channel === "not-slack")).toBe(false);
  });

  it("tolerates a leading # on either side", async () => {
    const graph = await acme();
    graph.teams.get("stream-checkout")!.doc.channels = [{ type: "slack", name: "#stream-checkout" }];

    const plan = planSlackSync(graph, live());
    expect(plan.entries.find((e) => e.channel === "stream-checkout")!.action).toBe("update");
  });
});

describe("formatSlackPlan", () => {
  it("shows the before and after, and counts only real changes", async () => {
    const out = formatSlackPlan(planSlackSync(await acme(), live()));
    expect(out).toContain("~ #stream-checkout (stream-checkout)");
    expect(out).toContain("    - (no topic)");
    expect(out).toContain("4 topic(s) to update.");
  });

  it("calls out conflicts and unclaimed channels without counting them as changes", async () => {
    const graph = await acme();
    graph.teams.get("platform-payments")!.doc.channels.push({ type: "slack", name: "stream-checkout" });

    const out = formatSlackPlan(planSlackSync(graph, [...live(), { id: "CX", name: "watercooler" }]));
    expect(out).toContain("! #stream-checkout is claimed by platform-payments and stream-checkout — left alone");
    expect(out).toContain("1 channel(s) no team declares, left alone");
    expect(out).toContain("3 topic(s) to update.");
  });
});
