import {
  buildOrgGraph,
  checkTopology,
  formatTopology,
  hasBlockingTopologyFindings,
  type OrgGraph,
  type TopologyKind,
} from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { printReport, sarifLevel, type ReportFormat } from "../report-format";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface TopologyOptions extends ConfigAwareOptions {
  format?: ReportFormat;
}

const TOPOLOGY_RULES: { id: TopologyKind; description: string }[] = [
  { id: "collaboration-overrun", description: "A collaboration past the duration it declared for itself" },
  { id: "collaboration-untimed", description: "A collaboration with no expected duration" },
  { id: "team-too-large", description: "A team past the size at which it can hold shared context" },
  { id: "collaboration-overload", description: "A team in more concurrent collaborations than it can sustain" },
  { id: "platform-depends-on-stream", description: "A platform team depending on a team it exists to serve" },
  { id: "blocking-dependency", description: "A dependency the team itself labelled as blocking" },
];

function sourceFor(graph: OrgGraph, teamId: string): string | undefined {
  return graph.teams.get(teamId)?.sourceUri;
}

/**
 * Reports Team Topologies design smells.
 *
 * Exits 0 unless the org configured a kind as `blocking`. These findings are prompts for a
 * conversation, not defects — a nine-month collaboration can be the right call, and a check that
 * failed builds over it by default would be wrong more often than it was useful.
 */
export async function runTopology(patterns: string[], options: TopologyOptions = {}): Promise<number> {
  const format = options.format ?? "text";

  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) {
    console.error(input.error);
    return 1;
  }
  const { config, sourcePath } = input;
  if (input.patterns.length === 0) {
    console.error(NO_PATTERNS_MESSAGE);
    return 1;
  }

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${input.patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph(resolveOptions(seeds));
  if (format === "text") warnUnresolved(graph);

  const report = checkTopology(graph, config.topology);

  printReport({
    format,
    report,
    text: () => {
      const base = formatTopology(report);
      return sourcePath && report.findings.length > 0 ? `${base}\n(topology thresholds from ${sourcePath})` : base;
    },
    toolName: "teamapi topology",
    rules: TOPOLOGY_RULES,
    findings: report.findings.map((finding) => ({
      ruleId: finding.kind,
      level: sarifLevel(finding.severity),
      message: finding.detail,
      filePath: sourceFor(graph, finding.teamId),
    })),
    baseDir: process.cwd(),
  });

  return hasBlockingTopologyFindings(report) ? 1 : 0;
}
