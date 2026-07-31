import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatGaps, planGaps, type GapFinding, type GapKind } from "../gaps/plan";
import { buildOrgGraph } from "../resolve/graph-builder";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const DRIFTWOOD_ROOT = path.resolve(__dirname, "../../../../examples/driftwood-org");

/** Both example orgs resolve their whole graph from any one seed, so a single path is enough. */
const acme = () => buildOrgGraph({ seedUris: [path.join(ACME_ROOT, "stream-checkout/teamapi.yml")] });
const driftwood = () => buildOrgGraph({ seedUris: [path.join(DRIFTWOOD_ROOT, "stream-insights/teamapi.yml")] });
/** A team with no services, no agents and no outbound edges — nothing to find. */
const isolated = () => buildOrgGraph({ seedUris: [path.join(ACME_ROOT, "enabling-devex/teamapi.yml")] });

const kinds = (findings: GapFinding[], kind: GapKind) => findings.filter((f) => f.kind === kind);

describe("planGaps", () => {
  it("finds nothing in a team with no services, agents or cross-team edges", async () => {
    const report = planGaps(await isolated());
    expect(report.findings).toEqual([]);
    expect(report.matched).toBe(0);
  });

  it("reports a subscription no declared service publishes as blocking", async () => {
    const found = kinds(planGaps(await driftwood()).findings, "orphan-subscription");
    expect(found).toEqual([
      {
        kind: "orphan-subscription",
        severity: "blocking",
        teamId: "platform-data",
        subject: "ModelTrained",
        detail: "'feature-store' subscribes to 'ModelTrained', which no declared service publishes",
      },
    ]);
  });

  it("reports an agent whose ownerId names nobody on the team as blocking", async () => {
    const found = kinds(planGaps(await driftwood()).findings, "dangling-owner");
    expect(found).toEqual([
      {
        kind: "dangling-owner",
        severity: "blocking",
        teamId: "platform-data",
        subject: "pipeline-reviewer",
        detail: "agent 'pipeline-reviewer' is owned by 'dana-whitfield', who is not a member of platform-data",
      },
    ]);
  });

  it("reports an agent with no ownerId at all as a warning", async () => {
    const found = kinds(planGaps(await driftwood()).findings, "unaccountable-agent");
    expect(found.map((f) => f.subject)).toEqual(["report-writer", "dashboard-qa"]);
    expect(found.every((f) => f.severity === "warning")).toBe(true);
  });

  it("counts an agent with a resolving owner as a matched seam rather than a finding", async () => {
    const report = planGaps(await driftwood());
    expect(report.findings.some((f) => f.subject === "backfill-runner")).toBe(false);
  });

  it("reports a vacant role other teams report into, naming those teams", async () => {
    const found = kinds(planGaps(await acme()).findings, "vacant-load-bearing");
    expect(found).toEqual([
      {
        kind: "vacant-load-bearing",
        severity: "warning",
        teamId: "platform-payments",
        subject: "head-of-engineering",
        detail:
          "'head-of-engineering' on platform-payments is vacant, but stream-checkout, stream-onboarding report(s) into it",
      },
    ]);
  });

  it("ignores a vacant role nobody reports into", async () => {
    // enabling-devex's coach is filled; the point is that no vacancy anywhere else is reported
    // just for being vacant — only the load-bearing one above is.
    const found = kinds(planGaps(await acme()).findings, "vacant-load-bearing");
    expect(found).toHaveLength(1);
  });

  it("reports a one-sided collaboration", async () => {
    const found = kinds(planGaps(await acme()).findings, "unacknowledged");
    expect(found).toEqual([
      {
        kind: "unacknowledged",
        severity: "warning",
        teamId: "stream-checkout",
        subject: "stream-onboarding",
        detail: "stream-checkout declares a collaboration with stream-onboarding, which declares nothing back",
      },
    ]);
  });

  it("does not treat one-directional x-as-a-service or facilitating edges as unacknowledged", async () => {
    // stream-checkout -> platform-payments is x-as-a-service and stream-onboarding ->
    // enabling-devex is facilitating; both are deliberately one-way in Team Topologies.
    const found = kinds(planGaps(await acme()).findings, "unacknowledged");
    expect(found.map((f) => f.subject)).not.toContain("platform-payments");
    expect(found.map((f) => f.subject)).not.toContain("enabling-devex");
  });

  it("reports a published event nothing subscribes to as a warning", async () => {
    const found = kinds(planGaps(await acme()).findings, "unconsumed-event");
    expect(found.map((f) => f.subject).sort()).toEqual(["LedgerEntryPosted", "OrderPlaced"]);
    expect(found.every((f) => f.severity === "warning")).toBe(true);
  });

  it("leaves the example org green: findings, but nothing blocking", async () => {
    const report = planGaps(await acme());
    expect(report.findings).toHaveLength(4);
    expect(report.findings.filter((f) => f.severity === "blocking")).toEqual([]);
    expect(report.matched).toBe(9);
  });

  it("warns when a team runs active agents but scored no supervision load", async () => {
    const found = kinds(planGaps(await driftwood()).findings, "unscored-supervision");
    expect(found.map((f) => f.teamId)).toEqual(["platform-data", "stream-insights"]);
    expect(found[0]!.detail).toContain("2 active agent(s)");
  });

  it("stays quiet about supervision once a team has scored it", async () => {
    // platform-payments runs five agents and declares cognitiveLoad.supervision.
    expect(kinds(planGaps(await acme()).findings, "unscored-supervision")).toEqual([]);
  });

  it("counts cross-team role ties by whether the reporting hierarchy explains them", async () => {
    expect(planGaps(await acme()).roleTies).toEqual({ formal: 2, informal: 2 });
    expect(planGaps(await driftwood()).roleTies).toEqual({ formal: 1, informal: 2 });
  });

  it("finds both blocking kinds in the deliberately broken org", async () => {
    const report = planGaps(await driftwood());
    expect(
      report.findings
        .filter((f) => f.severity === "blocking")
        .map((f) => f.kind)
        .sort(),
    ).toEqual(["dangling-owner", "orphan-subscription"]);
  });
});

describe("formatGaps", () => {
  it("says so plainly when there is nothing to report", async () => {
    expect(formatGaps(planGaps(await isolated()))).toBe("No gaps. 0 seam(s) checked, each with someone on both sides.");
  });

  it("stays silent about role ties when every one of them is a reporting line", async () => {
    // A single team resolved on its own has no cross-team ties at all, informal or otherwise.
    expect(formatGaps(planGaps(await isolated()))).not.toContain("Reporting lines explain");
  });

  it("reports how much of the cross-team role graph the hierarchy explains", async () => {
    expect(formatGaps(planGaps(await acme()))).toContain("Reporting lines explain 2 of 4 cross-team role relationship");
  });

  it("prefixes each kind with its glyph and ends with a counted summary", async () => {
    const out = formatGaps(planGaps(await driftwood()));
    expect(out).toContain("! orphan-subscription:");
    expect(out).toContain("! dangling-owner:");
    expect(out).toContain("- unaccountable-agent:");
    expect(out).toContain("- unconsumed-event:");
    expect(out).toContain("? vacant-load-bearing:");
    expect(out).toContain("~ unacknowledged:");
    expect(out).toContain("- unscored-supervision:");
    expect(out).toContain("9 finding(s), 2 blocking; 2 seam(s) checked.");
  });
});
