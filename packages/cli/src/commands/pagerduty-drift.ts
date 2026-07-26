import {
  buildOrgGraph,
  formatPagerDutyDrift,
  PagerDutyClient,
  planPagerDutyDrift,
  type PagerDutyService,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface PagerDutyDriftOptions {
  token?: string;
  url?: string;
}

/** Reports where PagerDuty and the declared org graph disagree about who gets paged. Exits
 * non-zero only for a declared service that escalates to nobody, so this can gate a required
 * check without ordinary drift failing the build. */
export async function runPagerDutyDrift(patterns: string[], options: PagerDutyDriftOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const token = options.token ?? process.env.PAGERDUTY_TOKEN;
  if (!token) {
    console.error("A PagerDuty token is required: pass --token or set PAGERDUTY_TOKEN.");
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  let services: PagerDutyService[];
  try {
    services = await new PagerDutyClient({ token, baseUrl: options.url }).listServices();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const report = planPagerDutyDrift(graph, services);
  console.log(formatPagerDutyDrift(report));
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
