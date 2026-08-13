import { buildOrgGraph, type OrgGraph } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { printReport, type ReportFormat } from "../report-format";

export interface ValidateOptions {
  format?: ReportFormat;
}

/** The structured form of a validation run, for `--format json`. Deliberately not the whole
 * `OrgGraph`: `GET /graph` already serves that, and a validation consumer wants the verdict. */
interface ValidateReport {
  ok: boolean;
  teams: { id: string; type: string; sourceUri: string }[];
  unresolved: { fromUri: string; ref: string; reason: string }[];
}

function toReport(graph: OrgGraph): ValidateReport {
  return {
    ok: graph.unresolved.length === 0,
    teams: [...graph.teams.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((team) => ({ id: team.id, type: team.doc.info.type, sourceUri: team.sourceUri })),
    unresolved: graph.unresolved,
  };
}

/** Writes the human-readable form, keeping failures on stderr so `teamapi validate > teams.txt`
 * still shows the errors on the terminal instead of redirecting them into the file. */
function printText(report: ValidateReport, seedCount: number): void {
  console.log(`Resolved ${report.teams.length} team(s) from ${seedCount} seed file(s):`);
  for (const team of report.teams) console.log(`  - ${team.id} (${team.type}) <- ${team.sourceUri}`);

  if (report.ok) {
    console.log("\nNo unresolved references. Validation passed.");
    return;
  }
  console.error(`\n${report.unresolved.length} unresolved reference(s):`);
  for (const u of report.unresolved) console.error(`  - ${u.ref}: ${u.reason}`);
}

export async function runValidate(patterns: string[], options: ValidateOptions = {}): Promise<number> {
  const format = options.format ?? "text";
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  const report = toReport(graph);

  if (format === "text") {
    printText(report, seeds.length);
    return report.ok ? 0 : 1;
  }

  printReport({
    format,
    report,
    toolName: "teamapi validate",
    rules: [{ id: "unresolved-ref", description: "A $ref that could not be resolved to a valid Team API document" }],
    findings: report.unresolved.map((entry) => ({
      ruleId: "unresolved-ref",
      level: "error" as const,
      message: `${entry.ref}: ${entry.reason}`,
      filePath: entry.fromUri,
    })),
    baseDir: process.cwd(),
  });

  return report.ok ? 0 : 1;
}
