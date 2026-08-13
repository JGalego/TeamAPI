import {
  buildOrgGraph,
  findNameConflicts,
  formatNameConflicts,
  type NameConflict,
  type OrgGraph,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { printReport, type ReportFormat } from "../report-format";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface ValidateOptions extends ConfigAwareOptions {
  format?: ReportFormat;
}

/** The structured form of a validation run, for `--format json`. Deliberately not the whole
 * `OrgGraph`: `GET /graph` already serves that, and a validation consumer wants the verdict. */
interface ValidateReport {
  ok: boolean;
  teams: { id: string; type: string; sourceUri: string }[];
  unresolved: { fromUri: string; ref: string; reason: string }[];
  /** Names two teams both claim. Distinct from `unresolved`: every document here resolved
   * perfectly, and the org is still ambiguous. */
  conflicts: NameConflict[];
}

function toReport(graph: OrgGraph): ValidateReport {
  const conflicts = findNameConflicts(graph);
  return {
    ok: graph.unresolved.length === 0 && conflicts.length === 0,
    teams: [...graph.teams.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((team) => ({ id: team.id, type: team.doc.info.type, sourceUri: team.sourceUri })),
    unresolved: graph.unresolved,
    conflicts,
  };
}

/** Writes the human-readable form, keeping failures on stderr so `teamapi validate > teams.txt`
 * still shows the errors on the terminal instead of redirecting them into the file. */
function printText(report: ValidateReport, seedCount: number): void {
  console.log(`Resolved ${report.teams.length} team(s) from ${seedCount} seed file(s):`);
  for (const team of report.teams) console.log(`  - ${team.id} (${team.type}) <- ${team.sourceUri}`);

  if (report.ok) {
    console.log("\nNo unresolved references or name conflicts. Validation passed.");
    return;
  }
  if (report.unresolved.length > 0) {
    console.error(`\n${report.unresolved.length} unresolved reference(s):`);
    for (const u of report.unresolved) console.error(`  - ${u.ref}: ${u.reason}`);
  }
  if (report.conflicts.length > 0) {
    console.error(`\n${report.conflicts.length} name conflict(s):`);
    console.error(formatNameConflicts(report.conflicts));
  }
}

export async function runValidate(patterns: string[], options: ValidateOptions = {}): Promise<number> {
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
  const report = toReport(graph);

  if (format === "text") {
    printText(report, seeds.length);
    return report.ok ? 0 : 1;
  }

  printReport({
    format,
    report,
    toolName: "teamapi validate",
    rules: [
      { id: "unresolved-ref", description: "A $ref that could not be resolved to a valid Team API document" },
      { id: "duplicate-service", description: "Two teams declare a service with the same name" },
      { id: "duplicate-channel", description: "Two teams declare the same communication channel" },
    ],
    findings: [
      ...report.unresolved.map((entry) => ({
        ruleId: "unresolved-ref",
        level: "error" as const,
        message: `${entry.ref}: ${entry.reason}`,
        filePath: entry.fromUri,
      })),
      ...report.conflicts.map((conflict) => ({
        ruleId: conflict.kind,
        level: "error" as const,
        message: conflict.detail,
        // Annotated on the first claimant's document; the detail names every team involved, since
        // the conflict belongs to all of them rather than to whichever sorts first.
        filePath: graph.teams.get(conflict.teamIds[0]!)?.sourceUri,
      })),
    ],
    baseDir: process.cwd(),
  });

  return report.ok ? 0 : 1;
}
