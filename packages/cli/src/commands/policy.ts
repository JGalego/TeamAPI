import { buildOrgGraph, checkPolicies, formatPolicyReport } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

/**
 * Checks every declared policy against the org graph.
 *
 * Exits non-zero on a `blocking` violation, and on a `blocking` policy nothing enforces — the
 * latter deliberately, because a policy that claims to block and is checked by nobody is the
 * failure this command exists to surface. `delegated` rules never fail the build: naming an
 * external enforcer is the correct thing to do, not a finding to fix.
 */
export async function runPolicy(patterns: string[]): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  const report = checkPolicies(graph);
  console.log(formatPolicyReport(report));
  return report.findings.some((finding) => finding.severity === "blocking" && finding.outcome !== "delegated") ? 1 : 0;
}
