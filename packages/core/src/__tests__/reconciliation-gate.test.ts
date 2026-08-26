import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "../evidence/ledger";
import type { OrgGraph, ResolvedTeam } from "../model/org-graph";
import {
  evaluateReconciliation,
  gateReconciliationPlan,
  type ReconciliationGatePolicy,
} from "../reconcile/policy-gate";

const team: ResolvedTeam = {
  id: "payments",
  sourceUri: "payments.yml",
  doc: {
    teamApiVersion: "1.0.0",
    id: "payments",
    info: { name: "Payments", type: "platform" },
    channels: [],
    searchTerms: [],
    services: [],
    roles: [],
    members: [],
    meetings: [],
    interactions: [],
    dependencies: [],
    agents: [],
    memory: [],
    specifications: [],
    steeringDocuments: [],
    prompts: [],
    playbooks: [],
    policies: [],
    knowledgeBase: [],
    workflows: [],
    sessions: [],
  },
};
const graph: OrgGraph = {
  teams: new Map([[team.id, team]]),
  edges: [],
  roleEdges: [],
  unresolved: [],
  meta: { resolvedAt: "", sourceRoots: [] },
};
const policy: ReconciliationGatePolicy = {
  autoApproveThrough: "medium",
  requiredEvidence: ["audit-log"],
  blockOnPolicySeverity: ["blocking"],
};
const action = {
  id: "sync-1",
  system: "okta",
  teamId: "payments",
  operation: "add-member",
  targetId: "payments",
  risk: "low" as const,
};

function ledgerWithEvidence() {
  const ledger = new EvidenceLedger();
  ledger.ingest({
    id: "audit-1",
    kind: "audit-log",
    source: "okta",
    observedAt: "2026-08-26T12:00:00.000Z",
    targetType: "team",
    targetId: "payments",
    summary: "Directory snapshot",
    confidence: 1,
    attributes: {},
  });
  return ledger;
}

describe("reconciliation policy gate", () => {
  it("approves low-risk actions backed by required evidence", () => {
    expect(evaluateReconciliation(graph, ledgerWithEvidence(), action, policy)).toMatchObject({
      decision: "approved",
      reasons: [],
    });
  });

  it("sends unsupported or high-risk actions to review", () => {
    expect(evaluateReconciliation(graph, new EvidenceLedger(), action, policy)).toMatchObject({
      decision: "manual-review",
      reasons: ["missing required evidence: audit-log"],
    });
    expect(evaluateReconciliation(graph, ledgerWithEvidence(), { ...action, risk: "high" }, policy).decision).toBe(
      "manual-review",
    );
  });

  it("blocks actions when the team violates a blocking policy", () => {
    const governed: OrgGraph = {
      ...graph,
      teams: new Map([
        [
          team.id,
          {
            ...team,
            doc: {
              ...team.doc,
              policies: [
                {
                  id: "owners",
                  name: "Owners",
                  category: "custom",
                  severity: "blocking",
                  rules: [{ key: "agents_require_owner", value: true }],
                  enforcedBy: [],
                },
              ],
              agents: [
                {
                  id: "bot",
                  name: "Bot",
                  provider: "internal",
                  role: "review",
                  capabilities: [],
                  status: "active",
                  permissions: [],
                  tags: [],
                },
              ],
            },
          },
        ],
      ]),
    };
    expect(evaluateReconciliation(governed, ledgerWithEvidence(), action, policy).decision).toBe("blocked");
  });

  it("orders plan decisions by stable action id", () => {
    const decisions = gateReconciliationPlan(
      graph,
      ledgerWithEvidence(),
      [
        { ...action, id: "z" },
        { ...action, id: "a" },
      ],
      policy,
    );
    expect(decisions.map((entry) => entry.action.id)).toEqual(["a", "z"]);
  });
});
