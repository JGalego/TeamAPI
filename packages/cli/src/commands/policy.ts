import { buildOrgGraph, checkPolicies, formatPolicyReport, type OrgGraph } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { printReport, sarifLevel, type ReportFormat } from "../report-format";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface PolicyOptions extends ConfigAwareOptions {
  format?: ReportFormat;
}

const POLICY_RULES = [
  { id: "violated", description: "A rule checked against the org graph that the team does not satisfy" },
  { id: "unenforced", description: "A rule nothing checks: no built-in evaluator and no enforcedBy" },
  { id: "misconfigured", description: "A rule whose value is the wrong shape for its key" },
  { id: "delegated", description: "A rule an external enforcer named in enforcedBy is responsible for" },
];

function sourceFor(graph: OrgGraph, teamId: string): string | undefined {
  return graph.teams.get(teamId)?.sourceUri;
}

/**
 * Checks every declared policy against the org graph.
 *
 * Exits non-zero on a `blocking` violation, and on a `blocking` policy nothing enforces — the
 * latter deliberately, because a policy that claims to block and is checked by nobody is the
 * failure this command exists to surface. `delegated` rules never fail the build: naming an
 * external enforcer is the correct thing to do, not a finding to fix.
 */
export async function runPolicy(patterns: string[], options: PolicyOptions = {}): Promise<number> {
  const format = options.format ?? "text";

  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) {
    console.error(input.error);
    return 1;
  }
  if (input.patterns.length === 0) {
    console.error(NO_PATTERNS_MESSAGE);
    return 1;
  }

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${input.patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  if (format === "text") warnUnresolved(graph);

  const report = checkPolicies(graph);
  printReport({
    format,
    report,
    text: () => formatPolicyReport(report),
    toolName: "teamapi policy",
    rules: POLICY_RULES,
    findings: report.findings.map((finding) => ({
      ruleId: finding.outcome,
      level: sarifLevel(finding.severity),
      message: `${finding.policyName} (${finding.ruleKey}): ${finding.detail}`,
      filePath: sourceFor(graph, finding.teamId),
    })),
    baseDir: process.cwd(),
  });
  return report.findings.some((finding) => finding.severity === "blocking" && finding.outcome !== "delegated") ? 1 : 0;
}
