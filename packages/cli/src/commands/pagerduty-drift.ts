import {
  buildOrgGraph,
  formatPagerDutyDrift,
  PagerDutyClient,
  planPagerDutyDrift,
  type PagerDutyService,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface PagerDutyDriftOptions extends ConfigAwareOptions {
  token?: string;
  url?: string;
}

/** Reports where PagerDuty and the declared org graph disagree about who gets paged. Exits
 * non-zero only for a declared service that escalates to nobody, so this can gate a required
 * check without ordinary drift failing the build. */
export async function runPagerDutyDrift(patterns: string[], options: PagerDutyDriftOptions): Promise<number> {
  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) {
    console.error(input.error);
    return 1;
  }
  if (input.patterns.length === 0) {
    console.error(NO_PATTERNS_MESSAGE);
    return 1;
  }

  const url = options.url ?? input.config.defaults.pagerduty.url;

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${input.patterns.join(", ")}`);
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
    services = await new PagerDutyClient({ token, baseUrl: url }).listServices();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const report = planPagerDutyDrift(graph, services);
  console.log(formatPagerDutyDrift(report));
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
