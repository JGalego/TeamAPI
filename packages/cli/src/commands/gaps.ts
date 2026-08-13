import {
  applyGapRules,
  buildOrgGraph,
  formatGapRuleEffects,
  formatGaps,
  hasBlockingGaps,
  planGaps,
  type GapKind,
  type OrgGraph,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { printReport, sarifLevel, type ReportFormat } from "../report-format";
import { ConfigError, loadConfig } from "../config";

export interface GapsOptions {
  format?: ReportFormat;
  /** Path to a config file, instead of discovering one by walking up from the cwd. */
  config?: string;
  /** Ignore any config file: report every finding at its declared severity. */
  noConfig?: boolean;
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

/**
 * Reports the accountability holes between teams, after applying any configured severity
 * overrides and waivers. Exits non-zero on a blocking finding that no live waiver excused.
 */
export async function runGaps(patterns: string[], options: GapsOptions = {}): Promise<number> {
  const format = options.format ?? "text";

  let config;
  let sourcePath: string | undefined;
  try {
    ({ config, sourcePath } = options.noConfig
      ? { config: { gaps: { severity: {}, waivers: [] } }, sourcePath: undefined }
      : await loadConfig({ explicitPath: options.config }));
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  // Machine-readable output goes to stdout alone: a warning interleaved into it would make the
  // document unparseable for the consumer the format exists for.
  if (format === "text") warnUnresolved(graph);

  const report = applyGapRules(planGaps(graph), config.gaps);

  printReport({
    format,
    report,
    text: () => {
      const effects = formatGapRuleEffects(report);
      const base = formatGaps(report);
      if (!effects) return base;
      // Waivers and lapsed exemptions go above the summary line, so the counts at the bottom stay
      // the last thing read.
      return sourcePath ? `${effects}\n\n${base}\n(gap rules from ${sourcePath})` : `${effects}\n\n${base}`;
    },
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

  return hasBlockingGaps(report) ? 1 : 0;
}
