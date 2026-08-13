import { buildOrgGraph, formatGaps, planGaps, type GapKind, type OrgGraph } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { printReport, sarifLevel, type ReportFormat } from "../report-format";

export interface GapsOptions {
  format?: ReportFormat;
}

const GAP_RULES: { id: GapKind; description: string }[] = [
  { id: "orphan-subscription", description: "A service subscribes to an event no declared service publishes" },
  { id: "unconsumed-event", description: "A service publishes an event no declared service subscribes to" },
  { id: "dangling-owner", description: "An agent's ownerId names nobody on the team" },
  { id: "unaccountable-agent", description: "An agent names no human owner at all" },
  { id: "unscored-supervision", description: "Active agents, but no cognitiveLoad.supervision score" },
  { id: "vacant-load-bearing", description: "A vacant role another team's reporting line terminates in" },
  { id: "unacknowledged", description: "A declared collaboration the other team declares nothing back for" },
];

/** The document a finding is about, so SARIF annotates the right file. */
function sourceFor(graph: OrgGraph, teamId: string): string | undefined {
  return graph.teams.get(teamId)?.sourceUri;
}

/** Reports the accountability holes between teams. Exits non-zero only on the two findings where
 * the declaration looks complete and isn't — a subscription to an event nobody publishes, and an
 * agent owned by somebody who isn't on the team. */
export async function runGaps(patterns: string[], options: GapsOptions = {}): Promise<number> {
  const format = options.format ?? "text";
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  // Machine-readable output goes to stdout alone: a warning interleaved into it would make the
  // document unparseable for the consumer the format exists for.
  if (format === "text") warnUnresolved(graph);

  const report = planGaps(graph);
  printReport({
    format,
    report,
    text: () => formatGaps(report),
    toolName: "teamapi gaps",
    rules: GAP_RULES,
    findings: report.findings.map((finding) => ({
      ruleId: finding.kind,
      level: sarifLevel(finding.severity),
      message: finding.detail,
      filePath: sourceFor(graph, finding.teamId),
    })),
    baseDir: process.cwd(),
  });
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
