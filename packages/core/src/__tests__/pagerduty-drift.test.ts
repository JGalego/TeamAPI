import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import {
  formatPagerDutyDrift,
  normaliseServiceName,
  planPagerDutyDrift,
  type PagerDutyService,
} from "../apply/pagerduty-drift";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");
const acme = () => buildOrgGraph({ seedUris: [CHECKOUT_SEED] });

/** examples/acme-org declares four services across four teams. */
const DECLARED = ["checkout-api", "payments-api", "ledger", "onboarding-api"];

const policy = (name: string, responderCount = 2) => ({ id: `P${name}`, name, responderCount });

const healthy = (): PagerDutyService[] => [
  { id: "S1", name: "checkout-api", escalationPolicy: policy("stream-checkout on-call") },
  { id: "S2", name: "payments-api", escalationPolicy: policy("platform-payments on-call") },
  { id: "S3", name: "ledger", escalationPolicy: policy("platform-payments on-call") },
  { id: "S4", name: "onboarding-api", escalationPolicy: policy("stream-onboarding on-call") },
];

describe("normaliseServiceName", () => {
  it("collapses the ways the same service gets typed into PagerDuty", () => {
    for (const written of ["Checkout API", "checkout_api", "checkout-api", "CheckoutAPI"]) {
      expect(normaliseServiceName(written)).toBe("checkoutapi");
    }
  });
});

describe("planPagerDutyDrift", () => {
  it("finds no drift when every declared service escalates to its own team", async () => {
    const report = planPagerDutyDrift(await acme(), healthy());
    expect(report.findings).toEqual([]);
    expect(report.matched).toBe(DECLARED.length);
  });

  it("matches across naming styles rather than demanding an exact slug", async () => {
    const live = healthy();
    live[0] = { id: "S1", name: "Checkout API", escalationPolicy: policy("Stream Checkout on-call") };

    const report = planPagerDutyDrift(await acme(), live);
    expect(report.findings).toEqual([]);
  });

  it("blocks on a service whose escalation policy has nobody on it", async () => {
    const live = healthy();
    live[0]!.escalationPolicy = policy("stream-checkout on-call", 0);

    const report = planPagerDutyDrift(await acme(), live);
    expect(report.findings).toEqual([
      {
        kind: "unresponsive",
        severity: "blocking",
        teamId: "stream-checkout",
        service: "checkout-api",
        detail: "'checkout-api' escalates to 'stream-checkout on-call', which has nobody on it",
      },
    ]);
  });

  it("blocks on a monitored service with no escalation policy at all", async () => {
    const live = healthy();
    delete live[0]!.escalationPolicy;

    const report = planPagerDutyDrift(await acme(), live);
    expect(report.findings[0]).toMatchObject({ kind: "unresponsive", severity: "blocking" });
    expect(report.findings[0]!.detail).toContain("a page for it reaches nobody");
  });

  it("warns, but does not block, on a declared service PagerDuty has never heard of", async () => {
    const report = planPagerDutyDrift(
      await acme(),
      healthy().filter((s) => s.name !== "ledger"),
    );
    expect(report.findings).toEqual([
      {
        kind: "unmonitored",
        severity: "warning",
        teamId: "platform-payments",
        service: "ledger",
        detail: "'ledger' is declared by platform-payments but has no PagerDuty service",
      },
    ]);
  });

  it("warns about a PagerDuty service nothing declares", async () => {
    const live = [...healthy(), { id: "S9", name: "legacy-batch", escalationPolicy: policy("ops") }];
    const report = planPagerDutyDrift(await acme(), live);
    expect(report.findings).toEqual([
      {
        kind: "undeclared",
        severity: "warning",
        service: "legacy-batch",
        detail: "'legacy-batch' is in PagerDuty but no teamapi.yml declares it",
      },
    ]);
  });

  it("warns when the policy doesn't name the team that declares the service", async () => {
    const live = healthy();
    live[0]!.escalationPolicy = policy("Default Escalation Policy");

    const report = planPagerDutyDrift(await acme(), live);
    expect(report.findings[0]).toMatchObject({ kind: "misattributed", severity: "warning" });
    // still counted as matched: someone is on call, they just may be the wrong someone
    expect(report.matched).toBe(DECLARED.length);
  });
});

describe("formatPagerDutyDrift", () => {
  it("says so plainly when nothing is wrong", async () => {
    const out = formatPagerDutyDrift(planPagerDutyDrift(await acme(), healthy()));
    expect(out).toBe("No drift. 4 service(s) matched, each escalating to someone.");
  });

  it("marks each kind and counts the blocking ones separately", async () => {
    const live = healthy().filter((s) => s.name !== "ledger");
    live[0]!.escalationPolicy = policy("stream-checkout on-call", 0);
    live.push({ id: "S9", name: "legacy-batch", escalationPolicy: policy("ops") });

    const out = formatPagerDutyDrift(planPagerDutyDrift(await acme(), live));
    expect(out).toContain("! unresponsive:");
    expect(out).toContain("- unmonitored:");
    expect(out).toContain("+ undeclared:");
    // checkout-api is unresponsive and ledger is absent, so only two services matched
    expect(out).toContain("3 finding(s), 1 blocking; 2 service(s) matched.");
  });
});
