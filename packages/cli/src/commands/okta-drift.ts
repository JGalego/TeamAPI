import { buildOrgGraph, formatOktaDrift, OktaClient, planOktaDrift, type DirectoryGroup } from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface OktaDriftOptions extends ConfigAwareOptions {
  url?: string;
  token?: string;
  groupPrefix?: string;
}

/** Reports where declared membership and the directory disagree. Exits non-zero only when a
 * deactivated account is still listed on a team — the finding that makes the org chart name
 * someone who has left as accountable for a service. */
export async function runOktaDrift(patterns: string[], options: OktaDriftOptions): Promise<number> {
  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) {
    console.error(input.error);
    return 1;
  }
  if (input.patterns.length === 0) {
    console.error(NO_PATTERNS_MESSAGE);
    return 1;
  }

  const url = options.url ?? input.config.defaults.okta.url;
  if (!url) {
    console.error("An Okta org URL is required: pass --url or set `defaults.okta.url` in teamapi.config.yml.");
    return 1;
  }

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${input.patterns.join(", ")}`);
    return 1;
  }

  const token = options.token ?? process.env.OKTA_TOKEN;
  if (!token) {
    console.error("An Okta token is required: pass --token or set OKTA_TOKEN.");
    return 1;
  }

  const graph = await buildOrgGraph(resolveOptions(seeds));
  warnUnresolved(graph);

  let groups: DirectoryGroup[];
  try {
    groups = await new OktaClient({ token, url }).listGroups();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const report = planOktaDrift(graph, groups, { groupPrefix: options.groupPrefix });
  console.log(formatOktaDrift(report));
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
