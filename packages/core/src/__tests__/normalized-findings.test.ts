import { describe, expect, it } from "vitest";
import {
  findingId,
  normalizeGapFinding,
  normalizePolicyFinding,
  normalizeShadowAiFinding,
  normalizeTopologyFinding,
  sortFindings,
} from "../report/findings";

describe("normalized findings", () => {
  it("builds stable IDs from semantic identity rather than mutable prose", () => {
    expect(findingId("gaps", "dangling-owner", "platform-payments", "review-bot")).toBe(
      "gaps/dangling-owner/platform-payments/review-bot",
    );
    expect(
      normalizeGapFinding({
        kind: "dangling-owner",
        severity: "blocking",
        teamId: "platform-payments",
        subject: "review-bot",
        detail: "first wording",
      }).id,
    ).toBe(
      normalizeGapFinding({
        kind: "dangling-owner",
        severity: "warning",
        teamId: "platform-payments",
        subject: "review-bot",
        detail: "different wording",
      }).id,
    );
  });

  it("normalizes each check without discarding its identity", () => {
    expect(
      normalizePolicyFinding({
        outcome: "violated",
        severity: "blocking",
        teamId: "checkout",
        policyId: "agents",
        policyName: "Agent policy",
        ruleKey: "agents_allowed",
        detail: "declares one active agent",
      }),
    ).toMatchObject({
      id: "policy/violated%2Fagents_allowed/checkout/agents",
      source: "policy",
      ruleId: "violated/agents_allowed",
      targetType: "team",
    });
    expect(
      normalizeTopologyFinding({
        kind: "team-too-large",
        severity: "warning",
        teamId: "checkout",
        detail: "ten members",
      }),
    ).toMatchObject({ id: "topology/team-too-large/checkout", source: "topology" });
    expect(
      normalizeShadowAiFinding({
        kind: "unowned",
        severity: "warning",
        subject: "unknown-repo",
        detail: "contains an SDK",
      }),
    ).toMatchObject({
      id: "shadow-ai/unowned/unknown-repo/unknown-repo",
      targetType: "repository",
      targetId: "unknown-repo",
    });
  });

  it("sorts blocking findings before warning and informational findings", () => {
    const findings = [
      normalizePolicyFinding({
        outcome: "delegated",
        severity: "info",
        teamId: "zeta",
        policyId: "p",
        policyName: "P",
        ruleKey: "external",
        detail: "delegated",
      }),
      normalizeTopologyFinding({
        kind: "blocking-dependency",
        severity: "warning",
        teamId: "alpha",
        detail: "blocked",
      }),
      normalizeGapFinding({
        kind: "orphan-subscription",
        severity: "blocking",
        teamId: "beta",
        subject: "Event",
        detail: "missing publisher",
      }),
    ];

    expect(sortFindings(findings).map((finding) => finding.severity)).toEqual(["blocking", "warning", "info"]);
  });
});
