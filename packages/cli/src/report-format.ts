import { buildSarif, type SarifFinding, type SarifLevel, type SarifRule } from "@jgalego/teamapi-core";

export const REPORT_FORMATS = ["text", "json", "sarif"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/**
 * Maps this project's two-value severity onto SARIF's three levels.
 *
 * `blocking` becomes `error` and `warning` becomes `warning`; `info` becomes `note`. The mapping
 * matters because GitHub's code scanning treats `error` as failing a required check and the others
 * as advisory, which is the same line the commands' exit codes already draw.
 */
export function sarifLevel(severity: string): SarifLevel {
  if (severity === "blocking") return "error";
  if (severity === "info") return "note";
  return "warning";
}

export interface PrintReportOptions<T> {
  format: ReportFormat;
  /** The full report object, emitted as-is for `--format json`. */
  report: T;
  /** Human-readable rendering, for `--format text`. Optional, for callers that print the text
   * form themselves — `validate` splits it across stdout and stderr, which a single string can't
   * express. */
  text?: () => string;
  toolName: string;
  toolVersion?: string;
  rules: SarifRule[];
  findings: SarifFinding[];
  baseDir?: string;
}

/**
 * Emits a report in the requested format.
 *
 * `json` prints the report object itself rather than a reformatting of the text output, so the
 * structured form stays the same shape the library already returns — anything a consumer can do
 * with `planGaps`'s return value in code, it can do with this in `jq`.
 */
export function printReport<T>(options: PrintReportOptions<T>): void {
  if (options.format === "json") {
    console.log(JSON.stringify(options.report, null, 2));
    return;
  }
  if (options.format === "sarif") {
    console.log(
      JSON.stringify(
        buildSarif({
          toolName: options.toolName,
          toolVersion: options.toolVersion,
          informationUri: "https://github.com/JGalego/TeamAPI",
          rules: options.rules,
          findings: options.findings,
          baseDir: options.baseDir,
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (options.text) console.log(options.text());
}
