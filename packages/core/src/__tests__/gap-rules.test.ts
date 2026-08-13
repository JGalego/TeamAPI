import { describe, expect, it } from "vitest";
import { applyGapRules, formatGapRuleEffects, hasBlockingGaps, isGapKind } from "../gaps/rules";
import type { GapFinding, GapsReport } from "../gaps/plan";

const orphan: GapFinding = {
  kind: "orphan-subscription",
  severity: "blocking",
  teamId: "platform-data",
  subject: "ModelTrained",
  detail: "'feature-store' subscribes to 'ModelTrained', which no declared service publishes",
};

const unconsumed: GapFinding = {
  kind: "unconsumed-event",
  severity: "warning",
  teamId: "stream-insights",
  subject: "InsightGenerated",
  detail: "'insights-api' publishes 'InsightGenerated', which no declared service subscribes to",
};

function reportOf(...findings: GapFinding[]): GapsReport {
  return { findings, matched: 3, roleTies: { formal: 1, informal: 0 } };
}

const NO_CONFIG = { severity: {}, waivers: [] };
const NOW = new Date("2026-06-15T12:00:00Z");

describe("applyGapRules — severity overrides", () => {
  it("changes nothing without a config", () => {
    const applied = applyGapRules(reportOf(orphan, unconsumed), NO_CONFIG, NOW);
    expect(applied.findings).toEqual([orphan, unconsumed]);
    expect(applied.waived).toEqual([]);
  });

  it("downgrades a kind to warning, so it stops failing the build", () => {
    const applied = applyGapRules(
      reportOf(orphan),
      { severity: { "orphan-subscription": "warning" }, waivers: [] },
      NOW,
    );
    expect(applied.findings[0]!.severity).toBe("warning");
    expect(hasBlockingGaps(applied)).toBe(false);
  });

  it("upgrades a kind to blocking", () => {
    const applied = applyGapRules(
      reportOf(unconsumed),
      { severity: { "unconsumed-event": "blocking" }, waivers: [] },
      NOW,
    );
    expect(hasBlockingGaps(applied)).toBe(true);
  });

  it("removes a kind entirely when set to off", () => {
    const applied = applyGapRules(
      reportOf(orphan, unconsumed),
      { severity: { "unconsumed-event": "off" }, waivers: [] },
      NOW,
    );
    expect(applied.findings.map((f) => f.kind)).toEqual(["orphan-subscription"]);
  });

  it("leaves other kinds untouched", () => {
    const applied = applyGapRules(
      reportOf(orphan, unconsumed),
      { severity: { "orphan-subscription": "off" }, waivers: [] },
      NOW,
    );
    expect(applied.findings).toEqual([unconsumed]);
  });
});

describe("applyGapRules — waivers", () => {
  const waiver = {
    kind: "orphan-subscription",
    teamId: "platform-data",
    subject: "ModelTrained",
    reason: "Publisher ships next sprint",
    expires: "2026-12-31",
  };

  it("excuses a matching finding without dropping it from the report", () => {
    const applied = applyGapRules(reportOf(orphan), { severity: {}, waivers: [waiver] }, NOW);
    expect(applied.findings).toEqual([]);
    expect(applied.waived).toEqual([{ finding: orphan, waiver }]);
    expect(hasBlockingGaps(applied)).toBe(false);
  });

  it("does not excuse a different team's finding of the same kind", () => {
    const elsewhere = { ...orphan, teamId: "stream-insights" };
    const applied = applyGapRules(reportOf(elsewhere), { severity: {}, waivers: [waiver] }, NOW);
    expect(applied.findings).toEqual([elsewhere]);
  });

  it("does not excuse a different subject", () => {
    const other = { ...orphan, subject: "SomethingElse" };
    const applied = applyGapRules(reportOf(other), { severity: {}, waivers: [waiver] }, NOW);
    expect(applied.findings).toEqual([other]);
  });

  it("applies org-wide when no teamId or subject narrows it", () => {
    const broad = { kind: "orphan-subscription", reason: "migration in flight" };
    const applied = applyGapRules(
      reportOf(orphan, { ...orphan, teamId: "other" }),
      { severity: {}, waivers: [broad] },
      NOW,
    );
    expect(applied.findings).toEqual([]);
    expect(applied.waived).toHaveLength(2);
  });

  it("never expires a waiver with no expires date", () => {
    const applied = applyGapRules(
      reportOf(orphan),
      { severity: {}, waivers: [{ kind: "orphan-subscription", reason: "forever" }] },
      NOW,
    );
    expect(applied.waived).toHaveLength(1);
    expect(applied.expired).toEqual([]);
  });
});

describe("applyGapRules — expiry", () => {
  const lapsed = { kind: "orphan-subscription", reason: "was meant to ship in May", expires: "2026-05-31" };

  it("stops excusing the finding once the date has passed", () => {
    const applied = applyGapRules(reportOf(orphan), { severity: {}, waivers: [lapsed] }, NOW);
    expect(applied.findings).toEqual([orphan]);
    expect(applied.waived).toEqual([]);
    expect(hasBlockingGaps(applied)).toBe(true);
  });

  it("reports the lapse, so a build does not just turn red for no visible reason", () => {
    const applied = applyGapRules(reportOf(orphan), { severity: {}, waivers: [lapsed] }, NOW);
    expect(applied.expired).toEqual([{ waiver: lapsed, matched: 1 }]);
  });

  it("still applies on the expiry date itself", () => {
    const applied = applyGapRules(
      reportOf(orphan),
      { severity: {}, waivers: [{ ...lapsed, expires: "2026-06-15" }] },
      NOW,
    );
    expect(applied.waived).toHaveLength(1);
  });

  it("expires the day after, compared date-only in UTC", () => {
    // Not eight hours early for whoever runs CI in Auckland.
    const lateInTheDay = new Date("2026-06-15T23:59:00Z");
    const applied = applyGapRules(
      reportOf(orphan),
      { severity: {}, waivers: [{ ...lapsed, expires: "2026-06-15" }] },
      lateInTheDay,
    );
    expect(applied.waived).toHaveLength(1);
  });
});

describe("applyGapRules — unused waivers", () => {
  it("reports a waiver that matched nothing", () => {
    const stale = { kind: "dangling-owner", reason: "fixed long ago" };
    const applied = applyGapRules(reportOf(orphan), { severity: {}, waivers: [stale] }, NOW);
    expect(applied.unused).toEqual([stale]);
  });

  it("does not report a waiver that was used", () => {
    const applied = applyGapRules(
      reportOf(orphan),
      { severity: {}, waivers: [{ kind: "orphan-subscription", reason: "known" }] },
      NOW,
    );
    expect(applied.unused).toEqual([]);
  });

  it("does not report an expired waiver that still matched as unused — it is already reported as expired", () => {
    const lapsed = { kind: "orphan-subscription", reason: "known", expires: "2020-01-01" };
    const applied = applyGapRules(reportOf(orphan), { severity: {}, waivers: [lapsed] }, NOW);
    expect(applied.unused).toEqual([]);
    expect(applied.expired).toHaveLength(1);
  });

  it("does not let a disabled kind make its waivers look used", () => {
    // `off` removes the finding before any waiver could claim it, so the waiver is correctly
    // reported as deletable rather than silently kept alive by a rule nobody runs.
    const applied = applyGapRules(
      reportOf(orphan),
      { severity: { "orphan-subscription": "off" }, waivers: [{ kind: "orphan-subscription", reason: "stale" }] },
      NOW,
    );
    expect(applied.unused).toHaveLength(1);
  });
});

describe("severity and waivers together", () => {
  it("waives a finding whose severity was re-graded", () => {
    const applied = applyGapRules(
      reportOf(orphan),
      {
        severity: { "orphan-subscription": "warning" },
        waivers: [{ kind: "orphan-subscription", reason: "known" }],
      },
      NOW,
    );
    expect(applied.findings).toEqual([]);
    expect(applied.waived[0]!.finding.severity).toBe("warning");
  });
});

describe("formatGapRuleEffects", () => {
  it("is empty when no rule did anything", () => {
    expect(formatGapRuleEffects(applyGapRules(reportOf(orphan), NO_CONFIG, NOW))).toBe("");
  });

  it("names the reason and the expiry on a waived finding", () => {
    const applied = applyGapRules(
      reportOf(orphan),
      {
        severity: {},
        waivers: [{ kind: "orphan-subscription", reason: "publisher ships next sprint", expires: "2026-12-31" }],
      },
      NOW,
    );
    const text = formatGapRuleEffects(applied);
    expect(text).toContain("publisher ships next sprint");
    expect(text).toContain("until 2026-12-31");
  });

  it("tells you to delete an unused waiver", () => {
    const applied = applyGapRules(
      reportOf(orphan),
      { severity: {}, waivers: [{ kind: "dangling-owner", reason: "old" }] },
      NOW,
    );
    expect(formatGapRuleEffects(applied)).toContain("delete it");
  });
});

describe("isGapKind", () => {
  it("accepts every kind planGaps can emit", () => {
    for (const kind of [
      "dangling-owner",
      "orphan-subscription",
      "unconsumed-event",
      "vacant-load-bearing",
      "unacknowledged",
      "unaccountable-agent",
      "unscored-supervision",
    ]) {
      expect(isGapKind(kind), kind).toBe(true);
    }
  });

  it("rejects a typo", () => {
    expect(isGapKind("orphan-subscriptions")).toBe(false);
  });
});
