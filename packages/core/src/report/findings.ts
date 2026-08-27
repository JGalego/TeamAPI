import type { GapFinding } from "../gaps/plan";
import type { TeamId } from "../model/org-graph";
import type { PolicyFinding } from "../policy/check";
import type { ShadowAiFinding } from "../shadow-ai/plan";
import type { TopologyFinding } from "../topology/heuristics";

export type FindingSource = "gaps" | "policy" | "topology" | "shadow-ai";
export type FindingSeverity = "blocking" | "warning" | "info";
export type FindingTargetType = "organization" | "team" | "service" | "agent" | "role" | "repository" | "event";

/**
 * The stable, check-independent finding shape used by aggregate reports and integrations.
 *
 * Individual checks retain their richer domain types. This is the boundary for consumers that
 * need to combine them: CI annotations, SARIF, HTML reports, snapshots and the dashboard. `id` is
 * deterministic and contains no timestamp, so the same problem can be followed between runs.
 */
export interface NormalizedFinding {
  id: string;
  source: FindingSource;
  ruleId: string;
  severity: FindingSeverity;
  targetType: FindingTargetType;
  targetId: string;
  teamId?: TeamId;
  subject?: string;
  summary: string;
  detail: string;
  documentation?: string;
  metadata?: Record<string, string | number | boolean>;
}

const DOCS: Record<FindingSource, string> = {
  gaps: "https://teamapi.dev/latest/guide/gaps.html",
  policy: "https://teamapi.dev/latest/guide/policy.html",
  topology: "https://teamapi.dev/latest/guide/topology.html",
  "shadow-ai": "https://teamapi.dev/latest/integrations/shadow-ai.html",
};

function idPart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

/** Builds a stable ID from semantic identity, deliberately excluding severity and prose. */
export function findingId(source: FindingSource, ruleId: string, targetId: string, subject?: string): string {
  return [source, ruleId, targetId, subject]
    .filter((part): part is string => Boolean(part))
    .map(idPart)
    .join("/");
}

export function normalizeGapFinding(finding: GapFinding): NormalizedFinding {
  const targetType: FindingTargetType =
    finding.kind === "dangling-owner" || finding.kind === "unaccountable-agent"
      ? "agent"
      : finding.kind === "vacant-load-bearing"
        ? "role"
        : finding.kind === "orphan-subscription" || finding.kind === "unconsumed-event"
          ? "event"
          : "team";
  const targetId = finding.subject ?? finding.teamId;
  return {
    id: findingId("gaps", finding.kind, finding.teamId, finding.subject),
    source: "gaps",
    ruleId: finding.kind,
    severity: finding.severity,
    targetType,
    targetId,
    teamId: finding.teamId,
    subject: finding.subject,
    summary: finding.kind,
    detail: finding.detail,
    documentation: DOCS.gaps,
  };
}

export function normalizePolicyFinding(finding: PolicyFinding): NormalizedFinding {
  const ruleId = `${finding.outcome}/${finding.ruleKey}`;
  return {
    id: findingId("policy", ruleId, finding.teamId, finding.policyId),
    source: "policy",
    ruleId,
    severity: finding.severity,
    targetType: "team",
    targetId: finding.teamId,
    teamId: finding.teamId,
    subject: finding.policyId,
    summary: finding.policyName,
    detail: finding.detail,
    documentation: DOCS.policy,
    metadata: { policyId: finding.policyId, policyName: finding.policyName, ruleKey: finding.ruleKey },
  };
}

export function normalizeTopologyFinding(finding: TopologyFinding): NormalizedFinding {
  return {
    id: findingId("topology", finding.kind, finding.teamId, finding.subject),
    source: "topology",
    ruleId: finding.kind,
    severity: finding.severity,
    targetType: "team",
    targetId: finding.teamId,
    teamId: finding.teamId,
    subject: finding.subject,
    summary: finding.kind,
    detail: finding.detail,
    documentation: DOCS.topology,
  };
}

export function normalizeShadowAiFinding(finding: ShadowAiFinding): NormalizedFinding {
  const targetId = finding.teamId ?? finding.subject;
  return {
    id: findingId("shadow-ai", finding.kind, targetId, finding.subject),
    source: "shadow-ai",
    ruleId: finding.kind,
    severity: finding.severity,
    targetType: finding.kind === "declared-unseen" ? "team" : "repository",
    targetId,
    teamId: finding.teamId,
    subject: finding.subject,
    summary: finding.kind,
    detail: finding.detail,
    documentation: DOCS["shadow-ai"],
  };
}

export function sortFindings(findings: NormalizedFinding[]): NormalizedFinding[] {
  const severity: Record<FindingSeverity, number> = { blocking: 0, warning: 1, info: 2 };
  return [...findings].sort(
    (a, b) =>
      severity[a.severity] - severity[b.severity] ||
      (a.teamId ?? "").localeCompare(b.teamId ?? "") ||
      a.id.localeCompare(b.id),
  );
}
