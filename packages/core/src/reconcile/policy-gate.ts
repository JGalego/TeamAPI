import type { EvidenceKind, EvidenceLedger } from "../evidence/ledger";
import type { OrgGraph } from "../model/org-graph";
import { checkPolicies } from "../policy/check";

export type ReconciliationRisk = "low" | "medium" | "high" | "critical";

export interface ReconciliationAction {
  id: string;
  system: string;
  teamId: string;
  operation: string;
  targetId: string;
  risk: ReconciliationRisk;
}

export interface ReconciliationGatePolicy {
  autoApproveThrough: Exclude<ReconciliationRisk, "critical">;
  requiredEvidence: EvidenceKind[];
  blockOnPolicySeverity: Array<"warning" | "blocking">;
}

export interface ReconciliationDecision {
  action: ReconciliationAction;
  decision: "approved" | "manual-review" | "blocked";
  reasons: string[];
  evidenceIds: string[];
}

const riskOrder: Record<ReconciliationRisk, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** Evaluates a proposed external-system change without executing it. */
export function evaluateReconciliation(
  graph: OrgGraph,
  ledger: EvidenceLedger,
  action: ReconciliationAction,
  policy: ReconciliationGatePolicy,
): ReconciliationDecision {
  if (!graph.teams.has(action.teamId)) throw new Error(`Unknown team id '${action.teamId}'`);

  const evidence = ledger.list({ targetId: action.targetId });
  const evidenceKinds = new Set(evidence.map((entry) => entry.kind));
  const missingEvidence = policy.requiredEvidence.filter((kind) => !evidenceKinds.has(kind));
  const policyFindings = checkPolicies(graph).findings.filter(
    (finding) =>
      finding.teamId === action.teamId &&
      policy.blockOnPolicySeverity.includes(finding.severity as "warning" | "blocking"),
  );

  const reasons: string[] = [];
  if (policyFindings.length > 0) {
    reasons.push(
      ...policyFindings.map(
        (finding) => `${finding.policyId}/${finding.ruleKey} is ${finding.outcome}: ${finding.detail}`,
      ),
    );
    return { action, decision: "blocked", reasons, evidenceIds: evidence.map((entry) => entry.id) };
  }

  if (action.risk === "critical") reasons.push("critical-risk reconciliation always requires human approval");
  if (riskOrder[action.risk] > riskOrder[policy.autoApproveThrough]) {
    reasons.push(`${action.risk}-risk reconciliation exceeds the ${policy.autoApproveThrough} auto-approval ceiling`);
  }
  if (missingEvidence.length > 0) reasons.push(`missing required evidence: ${missingEvidence.join(", ")}`);

  return {
    action,
    decision: reasons.length === 0 ? "approved" : "manual-review",
    reasons,
    evidenceIds: evidence.map((entry) => entry.id),
  };
}

export function gateReconciliationPlan(
  graph: OrgGraph,
  ledger: EvidenceLedger,
  actions: ReconciliationAction[],
  policy: ReconciliationGatePolicy,
): ReconciliationDecision[] {
  return [...actions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((action) => evaluateReconciliation(graph, ledger, action, policy));
}
