import {
  buildOrgGraph,
  formatShadowAi,
  planShadowAi,
  scanForAiArtifacts,
  type ScannedRepo,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { printReport, sarifLevel, type ReportFormat } from "../report-format";

export interface ShadowAiOptions {
  /** Directory whose immediate subdirectories are repository checkouts. */
  scan: string;
  format?: ReportFormat;
}

const SHADOW_AI_RULES = [
  { id: "unowned", description: "AI artifacts in a repository no declared team owns" },
  { id: "forbidden", description: "AI artifacts in a repository whose owning team's policy forbids agents" },
  { id: "undeclared", description: "AI artifacts in a repository whose team declares no agents" },
  { id: "declared-unseen", description: "A declared agent with no trace in any scanned repository" },
];

/** Reports AI adoption visible in repositories against what teams declare. Exits non-zero only
 * when artifacts turn up in a repo owned by a team whose policy forbids agents — ordinary
 * undeclared usage is a conversation, a policy breach is a gate. */
export async function runShadowAi(patterns: string[], options: ShadowAiOptions): Promise<number> {
  const format = options.format ?? "text";
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  if (format === "text") warnUnresolved(graph);

  let repos: ScannedRepo[];
  try {
    repos = await scanForAiArtifacts(options.scan);
  } catch (err) {
    console.error(`Could not scan ${options.scan}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (repos.length === 0) {
    console.error(`No repository directories found under ${options.scan}.`);
    return 1;
  }

  const report = planShadowAi(graph, repos);
  printReport({
    format,
    report,
    text: () => formatShadowAi(report),
    toolName: "teamapi shadow-ai",
    rules: SHADOW_AI_RULES,
    findings: report.findings.map((finding) => ({
      ruleId: finding.kind,
      level: sarifLevel(finding.severity),
      message: finding.detail,
      // `unowned` findings are about a repository no team claims, so there is no document to
      // annotate — SARIF carries them without a location rather than guessing at one.
      filePath: finding.teamId ? graph.teams.get(finding.teamId)?.sourceUri : undefined,
    })),
    baseDir: process.cwd(),
  });
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
