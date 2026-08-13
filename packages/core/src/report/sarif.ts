import * as path from "node:path";

/**
 * SARIF 2.1.0 output, so findings land as annotations on the changed lines of a pull request
 * instead of in a log nobody opens.
 *
 * The whole value of this format is that GitHub's code-scanning ingest understands it: upload a
 * SARIF file and every finding becomes an inline comment, a check-run annotation, and an entry in
 * the repository's security tab with history and dismissal. That is a categorically different
 * thing from `teamapi gaps` printing a list — the person who introduced an orphaned event contract
 * sees it on their own diff, at review time, without having gone looking.
 *
 * Only the parts of the (very large) SARIF schema that carry meaning here are emitted. A minimal,
 * valid document beats a complete one full of placeholders.
 */

/** Maps this project's severities onto the three levels SARIF defines. */
export type SarifLevel = "error" | "warning" | "note";

export interface SarifFinding {
  /** Stable identifier for the *kind* of finding, e.g. `orphan-subscription`. Becomes the rule id,
   * which is what GitHub groups and de-duplicates by across runs. */
  ruleId: string;
  level: SarifLevel;
  message: string;
  /** Absolute path of the file the finding is about. */
  filePath?: string;
}

export interface SarifRule {
  id: string;
  /** One line, shown in the rule listing. */
  description: string;
}

export interface BuildSarifOptions {
  toolName: string;
  toolVersion?: string;
  informationUri?: string;
  rules: SarifRule[];
  findings: SarifFinding[];
  /** Paths are emitted relative to this directory, because SARIF consumers resolve
   * `artifactLocation.uri` against the repository root — an absolute path from a CI runner
   * (`/home/runner/work/...`) matches no file in the repository and the annotation silently
   * vanishes. */
  baseDir?: string;
}

interface SarifResult {
  ruleId: string;
  level: SarifLevel;
  message: { text: string };
  locations?: {
    physicalLocation: { artifactLocation: { uri: string } };
  }[];
}

/** SARIF wants a relative URI with forward slashes, whatever the host platform uses. */
function toUri(filePath: string, baseDir: string | undefined): string {
  const relative = baseDir ? path.relative(baseDir, filePath) : filePath;
  return relative.split(path.sep).join("/");
}

export function buildSarif(options: BuildSarifOptions): Record<string, unknown> {
  const { toolName, toolVersion, informationUri, rules, findings, baseDir } = options;

  // Only the rules actually triggered, plus every rule declared — GitHub uses the declared set to
  // describe a finding, and a result naming a rule the run never declared is dropped on ingest.
  const results: SarifResult[] = findings.map((finding) => ({
    ruleId: finding.ruleId,
    level: finding.level,
    message: { text: finding.message },
    ...(finding.filePath
      ? { locations: [{ physicalLocation: { artifactLocation: { uri: toUri(finding.filePath, baseDir) } } }] }
      : {}),
  }));

  return {
    $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: toolName,
            ...(toolVersion ? { version: toolVersion } : {}),
            ...(informationUri ? { informationUri } : {}),
            rules: rules.map((rule) => ({
              id: rule.id,
              shortDescription: { text: rule.description },
            })),
          },
        },
        results,
      },
    ],
  };
}
