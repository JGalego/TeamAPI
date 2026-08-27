import { describe, expect, it } from "vitest";
import { ASSESSMENT_REPORT_VERSION, ASSESSMENT_STATE_VERSION } from "../assessment/build";
import { AssessmentStateSchema } from "../assessment/state-file";
import { EVIDENCE_LEDGER_VERSION, EvidenceLedger } from "../evidence/ledger";
import {
  NORMALIZED_FINDING_VERSION,
  findingId,
  normalizeGapFinding,
  normalizePolicyFinding,
  normalizeShadowAiFinding,
  normalizeTopologyFinding,
} from "../report/findings";

describe("public report compatibility", () => {
  it("keeps format versions explicit", () => {
    expect(NORMALIZED_FINDING_VERSION).toBe(1);
    expect(ASSESSMENT_REPORT_VERSION).toBe(1);
    expect(ASSESSMENT_STATE_VERSION).toBe(1);
    expect(EVIDENCE_LEDGER_VERSION).toBe(1);
    expect(EvidenceLedger.restore({ version: 1, entries: [], chains: [] }).snapshot()).toEqual({
      version: 1,
      entries: [],
      chains: [],
    });
    expect(() => EvidenceLedger.restore({ version: 2, entries: [], chains: [] })).toThrow();
  });

  it("rejects assessment state from an unknown format version", () => {
    expect(() => AssessmentStateSchema.parse({ version: 2 })).toThrow();
  });

  it("locks stable finding identity independently of severity and prose", () => {
    expect(findingId("gaps", "orphan-subscription", "checkout", "OrderPlaced")).toBe(
      "gaps/orphan-subscription/checkout/orderplaced",
    );
    expect(
      normalizeGapFinding({
        kind: "orphan-subscription",
        severity: "blocking",
        teamId: "checkout",
        subject: "OrderPlaced",
        detail: "no publisher",
      }),
    ).toMatchObject({ version: 1, ruleId: "orphan-subscription", targetType: "event" });
    expect(
      normalizePolicyFinding({
        outcome: "unenforced",
        severity: "warning",
        teamId: "checkout",
        policyId: "reviews",
        policyName: "Reviews",
        ruleKey: "min_approvals",
        detail: "no enforcer",
      }),
    ).toMatchObject({ version: 1, ruleId: "unenforced/min_approvals" });
    expect(
      normalizeTopologyFinding({
        kind: "collaboration-untimed",
        severity: "warning",
        teamId: "checkout",
        subject: "payments",
        detail: "no duration",
      }),
    ).toMatchObject({ version: 1, ruleId: "collaboration-untimed" });
    expect(
      normalizeShadowAiFinding({
        kind: "undeclared",
        severity: "warning",
        teamId: "checkout",
        subject: "checkout-api",
        detail: "contains an SDK",
      }),
    ).toMatchObject({ version: 1, ruleId: "undeclared", targetType: "repository" });
  });
});
