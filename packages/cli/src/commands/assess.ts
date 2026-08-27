import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  assessmentToHtml,
  buildAssessment,
  buildOrgGraph,
  buildSarif,
  formatAssessmentText,
  loadAssessmentState,
  saveAssessmentState,
  scanForAiArtifacts,
  type AssessmentState,
  type NormalizedFinding,
  type ScannedRepo,
} from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { sarifLevel } from "../report-format";
import { expandSeeds } from "../seeds";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";
import { warnUnresolved } from "../warn-unresolved";

export const ASSESS_FORMATS = ["text", "json", "html", "sarif"] as const;
export type AssessFormat = (typeof ASSESS_FORMATS)[number];

export interface AssessOptions extends ConfigAwareOptions {
  format?: AssessFormat;
  scan?: string;
  out?: string;
  state?: string;
}

async function readState(file: string | undefined): Promise<AssessmentState | undefined> {
  if (!file) return undefined;
  try {
    return await loadAssessmentState(file);
  } catch (error) {
    throw new Error(
      `Could not read assessment state ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sourceFor(finding: NormalizedFinding, graph: Awaited<ReturnType<typeof buildOrgGraph>>): string | undefined {
  return finding.teamId ? graph.teams.get(finding.teamId)?.sourceUri : undefined;
}

async function writeOutput(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, content.endsWith("\n") ? content : `${content}\n`, "utf-8");
}

/** Runs every local organizational check once and emits one normalized assessment. */
export async function runAssess(patterns: string[], options: AssessOptions = {}): Promise<number> {
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

  const graph = await buildOrgGraph(resolveOptions(seeds));
  if (format === "text") warnUnresolved(graph);

  let repositories: ScannedRepo[] | undefined;
  if (options.scan) {
    try {
      repositories = await scanForAiArtifacts(options.scan);
    } catch (error) {
      console.error(`Could not scan ${options.scan}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    if (repositories.length === 0) {
      console.error(`No repository directories found under ${options.scan}.`);
      return 1;
    }
  }

  let previous: AssessmentState | undefined;
  try {
    previous = await readState(options.state);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const report = buildAssessment(graph, {
    gaps: input.config.gaps,
    topology: input.config.topology,
    repositories,
    previous,
  });
  const rules = [...new Map(report.findings.map((finding) => [finding.ruleId, finding])).values()].map((finding) => ({
    id: finding.ruleId,
    description: `${finding.source}: ${finding.summary}`,
  }));
  const rendered =
    format === "json"
      ? JSON.stringify(report, null, 2)
      : format === "html"
        ? assessmentToHtml(report)
        : format === "sarif"
          ? JSON.stringify(
              buildSarif({
                toolName: "teamapi assess",
                informationUri: "https://teamapi.dev/latest/guide/evaluation.html",
                rules,
                findings: report.findings.map((finding) => ({
                  ruleId: finding.ruleId,
                  level: sarifLevel(finding.severity),
                  message: finding.detail,
                  filePath: sourceFor(finding, graph),
                })),
                baseDir: process.cwd(),
              }),
              null,
              2,
            )
          : formatAssessmentText(report);

  if (options.out) await writeOutput(options.out, rendered);
  else console.log(rendered);
  if (options.state) await saveAssessmentState(options.state, report.state);
  return report.summary.blocking > 0 ? 1 : 0;
}
