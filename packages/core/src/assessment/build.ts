import { applyGapRules, type GapRulesConfig } from "../gaps/rules";
import { planGaps } from "../gaps/plan";
import { snapshotOrg, type OrgSnapshot } from "../history/trends";
import type { OrgGraph } from "../model/org-graph";
import { checkPolicies } from "../policy/check";
import {
  normalizeGapFinding,
  normalizePolicyFinding,
  normalizeShadowAiFinding,
  normalizeTopologyFinding,
  sortFindings,
  type FindingSource,
  type NormalizedFinding,
} from "../report/findings";
import { planShadowAi } from "../shadow-ai/plan";
import type { ScannedRepo } from "../shadow-ai/scan";
import { checkTopology, DEFAULT_TOPOLOGY_CONFIG, type TopologyConfig } from "../topology/heuristics";

export const ASSESSMENT_STATE_VERSION = 1;
export const ASSESSMENT_REPORT_VERSION = 1;

export interface AssessmentState {
  version: typeof ASSESSMENT_STATE_VERSION;
  generatedAt: string;
  snapshot: OrgSnapshot;
  findingIds: string[];
}

export interface AssessmentSummary {
  total: number;
  blocking: number;
  warnings: number;
  info: number;
  bySource: Record<FindingSource, number>;
}

export interface AssessmentReport {
  version: typeof ASSESSMENT_REPORT_VERSION;
  generatedAt: string;
  snapshot: OrgSnapshot;
  summary: AssessmentSummary;
  findings: NormalizedFinding[];
  comparison: {
    baseline: boolean;
    newFindingIds: string[];
    resolvedFindingIds: string[];
  };
  scans: { shadowAi: boolean; repositories: number; quietRepositories: number };
  state: AssessmentState;
}

export interface AssessmentOptions {
  gaps?: GapRulesConfig;
  topology?: TopologyConfig;
  repositories?: ScannedRepo[];
  previous?: AssessmentState;
  now?: Date;
}

const EMPTY_GAP_RULES: GapRulesConfig = { severity: {}, waivers: [] };

/** Builds one deterministic report over every check that can be answered from the supplied data. */
export function buildAssessment(graph: OrgGraph, options: AssessmentOptions = {}): AssessmentReport {
  const gapReport = applyGapRules(planGaps(graph), options.gaps ?? EMPTY_GAP_RULES, options.now);
  const topologyReport = checkTopology(graph, options.topology ?? DEFAULT_TOPOLOGY_CONFIG, options.now);
  const shadowReport = options.repositories ? planShadowAi(graph, options.repositories) : undefined;

  const findings = sortFindings([
    ...gapReport.findings.map(normalizeGapFinding),
    ...checkPolicies(graph).findings.map(normalizePolicyFinding),
    ...topologyReport.findings.map(normalizeTopologyFinding),
    ...(shadowReport?.findings.map(normalizeShadowAiFinding) ?? []),
  ]);
  const findingIds = findings.map((finding) => finding.id);
  const previousIds = new Set(options.previous?.findingIds ?? []);
  const currentIds = new Set(findingIds);
  const generatedAt = (options.now ?? new Date()).toISOString();
  const snapshot = snapshotOrg(graph);

  return {
    version: ASSESSMENT_REPORT_VERSION,
    generatedAt,
    snapshot,
    summary: {
      total: findings.length,
      blocking: findings.filter((finding) => finding.severity === "blocking").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
      bySource: {
        gaps: findings.filter((finding) => finding.source === "gaps").length,
        policy: findings.filter((finding) => finding.source === "policy").length,
        topology: findings.filter((finding) => finding.source === "topology").length,
        "shadow-ai": findings.filter((finding) => finding.source === "shadow-ai").length,
      },
    },
    findings,
    comparison: {
      baseline: options.previous === undefined,
      newFindingIds: options.previous ? findingIds.filter((id) => !previousIds.has(id)) : [],
      resolvedFindingIds: options.previous
        ? options.previous.findingIds.filter((id) => !currentIds.has(id)).sort()
        : [],
    },
    scans: {
      shadowAi: shadowReport !== undefined,
      repositories: options.repositories?.length ?? 0,
      quietRepositories: shadowReport?.quiet ?? 0,
    },
    state: { version: ASSESSMENT_STATE_VERSION, generatedAt, snapshot, findingIds },
  };
}

export function formatAssessmentText(report: AssessmentReport): string {
  const { summary } = report;
  const lines = [
    `Assessment: ${summary.total} finding(s) — ${summary.blocking} blocking, ${summary.warnings} warning, ${summary.info} info.`,
    `Scope: ${report.snapshot.teams} team(s), ${report.snapshot.services} service(s), ${report.snapshot.agents} agent(s).`,
  ];
  if (report.scans.shadowAi) {
    lines.push(
      `Shadow AI: ${report.scans.repositories} repository checkout(s), ${report.scans.quietRepositories} quiet.`,
    );
  }
  if (!report.comparison.baseline) {
    lines.push(
      `Since baseline: ${report.comparison.newFindingIds.length} new, ${report.comparison.resolvedFindingIds.length} resolved.`,
    );
  }
  lines.push("");
  if (report.findings.length === 0) return [...lines, "No findings."].join("\n");
  for (const finding of report.findings) {
    const mark = finding.severity === "blocking" ? "!" : finding.severity === "warning" ? "-" : "·";
    lines.push(`${mark} ${finding.id}: ${finding.detail}`);
  }
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A self-contained report that can be opened locally or attached as a CI artifact. */
export function assessmentToHtml(report: AssessmentReport, title = "TeamAPI assessment"): string {
  const rows = report.findings
    .map(
      (finding) =>
        `<tr><td><span class="severity ${finding.severity}">${finding.severity}</span></td>` +
        `<td><code>${escapeHtml(finding.source)}</code></td><td><code>${escapeHtml(finding.targetId)}</code></td>` +
        `<td><strong>${escapeHtml(finding.summary)}</strong><br>${escapeHtml(finding.detail)}</td></tr>`,
    )
    .join("\n");
  const comparison = report.comparison.baseline
    ? "Baseline run"
    : `${report.comparison.newFindingIds.length} new · ${report.comparison.resolvedFindingIds.length} resolved`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>
body{margin:0;background:#f8fafc;color:#172033;font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1{margin:0}.meta{color:#526178}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.card{background:white;border:1px solid #dce3ec;border-radius:10px;padding:16px}.card b{display:block;font-size:26px}table{width:100%;border-collapse:collapse;background:white}th,td{padding:10px;text-align:left;border-bottom:1px solid #e6ebf1;vertical-align:top}.severity{padding:3px 7px;border-radius:999px}.blocking{color:#991b1b;background:#fee2e2}.warning{color:#92400e;background:#fef3c7}.info{color:#1e40af;background:#dbeafe}code{font-size:13px}@media(max-width:700px){.cards{grid-template-columns:repeat(2,1fr)}table{font-size:13px}}
</style></head><body><main><h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(report.generatedAt)} · ${escapeHtml(comparison)}</p>
<section class="cards"><div class="card"><b>${report.summary.blocking}</b>blocking</div><div class="card"><b>${report.summary.warnings}</b>warnings</div><div class="card"><b>${report.snapshot.teams}</b>teams</div><div class="card"><b>${report.snapshot.services}</b>services</div></section>
<table><thead><tr><th>Severity</th><th>Check</th><th>Target</th><th>Finding</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No findings.</td></tr>'}</tbody></table>
</main></body></html>`;
}
