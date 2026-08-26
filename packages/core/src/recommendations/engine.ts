import type { OrgGraph } from "../model/org-graph";
import { orgWideCognitiveLoadReport } from "../cognitive-load/score";
import { planGaps } from "../gaps/plan";
import { checkPolicies } from "../policy/check";
import type { EvidenceEntry, EvidenceLedger } from "../evidence/ledger";

export type RecommendationPriority = "low" | "medium" | "high" | "critical";

export interface OrgRecommendation {
  id: string;
  category: "accountability" | "architecture" | "governance" | "cognitive-load" | "reliability";
  priority: RecommendationPriority;
  title: string;
  rationale: string;
  teamIds: string[];
  evidenceIds: string[];
  sources: string[];
}

const priorityRank: Record<RecommendationPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function relatedEvidence(ledger: EvidenceLedger, targets: string[], minimumConfidence: number): EvidenceEntry[] {
  const wanted = new Set(targets.filter(Boolean));
  return ledger
    .list()
    .filter((entry) => wanted.has(entry.targetId) && entry.confidence >= minimumConfidence)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function recommendation(
  value: Omit<OrgRecommendation, "id" | "evidenceIds"> & { key: string; evidence: EvidenceEntry[] },
): OrgRecommendation {
  return {
    id: `recommendation/${slug(value.teamIds.join("-") || "org")}/${slug(value.category)}/${slug(value.key)}`,
    category: value.category,
    priority: value.priority,
    title: value.title,
    rationale: value.rationale,
    teamIds: [...new Set(value.teamIds)].sort(),
    evidenceIds: [...new Set(value.evidence.map((entry) => entry.id))].sort(),
    sources: [...new Set(value.sources)].sort(),
  };
}

/** Produces explainable recommendations from graph findings and immutable evidence. */
export function recommendOrgChanges(
  graph: OrgGraph,
  ledger: EvidenceLedger,
  options: { minimumConfidence?: number } = {},
): OrgRecommendation[] {
  const minimumConfidence = options.minimumConfidence ?? 0.5;
  const recommendations: OrgRecommendation[] = [];

  for (const finding of planGaps(graph).findings) {
    const category = ["dangling-owner", "unaccountable-agent", "vacant-load-bearing"].includes(finding.kind)
      ? "accountability"
      : finding.kind === "unscored-supervision"
        ? "cognitive-load"
        : "architecture";
    recommendations.push(
      recommendation({
        key: `${finding.kind}-${finding.subject ?? "team"}`,
        category,
        priority: finding.severity === "blocking" ? "critical" : "medium",
        title: `Resolve ${finding.kind.replaceAll("-", " ")} for ${finding.teamId}`,
        rationale: finding.detail,
        teamIds: [finding.teamId],
        evidence: relatedEvidence(ledger, [finding.teamId, finding.subject ?? ""], minimumConfidence),
        sources: [`gap:${finding.kind}:${finding.teamId}:${finding.subject ?? "team"}`],
      }),
    );
  }

  for (const finding of checkPolicies(graph).findings) {
    recommendations.push(
      recommendation({
        key: `${finding.policyId}-${finding.ruleKey}`,
        category: "governance",
        priority: finding.severity === "blocking" ? "critical" : finding.severity === "warning" ? "high" : "medium",
        title: `${finding.outcome === "unenforced" ? "Assign enforcement for" : "Remediate"} ${finding.policyName}`,
        rationale: finding.detail,
        teamIds: [finding.teamId],
        evidence: relatedEvidence(ledger, [finding.teamId, finding.policyId], minimumConfidence),
        sources: [`policy:${finding.outcome}:${finding.teamId}:${finding.policyId}:${finding.ruleKey}`],
      }),
    );
  }

  for (const load of orgWideCognitiveLoadReport(graph).filter((entry) => entry.label !== "sustainable")) {
    recommendations.push(
      recommendation({
        key: "cognitive-load",
        category: "cognitive-load",
        priority: load.label === "overloaded" ? "high" : "medium",
        title: `Reduce cognitive load for ${load.teamId}`,
        rationale: `${load.teamId} reports ${load.label} cognitive load (${load.total}/30 before supervision).`,
        teamIds: [load.teamId],
        evidence: relatedEvidence(ledger, [load.teamId], minimumConfidence),
        sources: [`cognitive-load:${load.teamId}:${load.total}:${load.label}`],
      }),
    );
  }

  const incidentsByTeam = new Map<string, EvidenceEntry[]>();
  for (const incident of ledger.list({ kind: "incident" }).filter((entry) => entry.confidence >= minimumConfidence)) {
    if (incident.targetType !== "team" || !graph.teams.has(incident.targetId)) continue;
    incidentsByTeam.set(incident.targetId, [...(incidentsByTeam.get(incident.targetId) ?? []), incident]);
  }
  for (const [teamId, incidents] of [...incidentsByTeam].sort(([a], [b]) => a.localeCompare(b))) {
    recommendations.push(
      recommendation({
        key: "incident-pattern",
        category: "reliability",
        priority: incidents.length >= 3 ? "critical" : incidents.length === 2 ? "high" : "medium",
        title: `Review incident evidence for ${teamId}`,
        rationale: `${incidents.length} incident observation${incidents.length === 1 ? "" : "s"} cite this team. Review recurring causes before changing ownership or topology.`,
        teamIds: [teamId],
        evidence: incidents,
        sources: incidents.map((entry) => `evidence:incident:${entry.id}`),
      }),
    );
  }

  return recommendations.sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id),
  );
}
