import { buildOrgGraph, formatGaps, planGaps } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

/** Reports the accountability holes between teams. Exits non-zero only on the two findings where
 * the declaration looks complete and isn't — a subscription to an event nobody publishes, and an
 * agent owned by somebody who isn't on the team. */
export async function runGaps(patterns: string[]): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  const report = planGaps(graph);
  console.log(formatGaps(report));
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
