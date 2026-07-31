import {
  buildOrgGraph,
  formatShadowAi,
  planShadowAi,
  scanForAiArtifacts,
  type ScannedRepo,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface ShadowAiOptions {
  /** Directory whose immediate subdirectories are repository checkouts. */
  scan: string;
}

/** Reports AI adoption visible in repositories against what teams declare. Exits non-zero only
 * when artifacts turn up in a repo owned by a team whose policy forbids agents — ordinary
 * undeclared usage is a conversation, a policy breach is a gate. */
export async function runShadowAi(patterns: string[], options: ShadowAiOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

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
  console.log(formatShadowAi(report));
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
