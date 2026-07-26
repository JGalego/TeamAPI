import {
  buildOrgGraph,
  formatPagerDutyDrift,
  planPagerDutyDrift,
  type PagerDutyService,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface PagerDutyDriftOptions {
  token?: string;
  url?: string;
}

interface RawService {
  id: string;
  name: string;
  escalation_policy?: { id: string; summary?: string; name?: string };
}

interface RawPolicy {
  id: string;
  name: string;
  escalation_rules?: Array<{ targets?: unknown[] }>;
}

/** PagerDuty's REST API paginates with `offset`/`limit` and reports `more`. */
async function fetchAll<T>(base: string, token: string, path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const url = `${base}${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`;
    const res = await fetch(url, {
      headers: { Authorization: `Token token=${token}`, Accept: "application/vnd.pagerduty+json;version=2" },
    });
    if (!res.ok) throw new Error(`PagerDuty returned ${res.status} ${res.statusText} for ${url}`);
    const body = (await res.json()) as Record<string, unknown>;
    const page = body[key];
    if (!Array.isArray(page)) throw new Error(`Unexpected response from ${url}: expected '${key}' to be an array`);
    out.push(...(page as T[]));
    if (!body.more) return out;
    offset += page.length;
    if (page.length === 0) return out; // defensive: `more` without progress would spin forever
  }
}

/** Escalation policies carry their rules; a policy with no targets pages nobody, which is the
 * finding worth blocking on, so responders are counted here rather than inferred later. */
async function fetchServices(options: PagerDutyDriftOptions): Promise<PagerDutyService[]> {
  const token = options.token ?? process.env.PAGERDUTY_TOKEN;
  if (!token) throw new Error("No PagerDuty token: pass --token or set PAGERDUTY_TOKEN");
  const base = (options.url ?? "https://api.pagerduty.com").replace(/\/+$/, "");

  const [services, policies] = await Promise.all([
    fetchAll<RawService>(base, token, "/services", "services"),
    fetchAll<RawPolicy>(base, token, "/escalation_policies", "escalation_policies"),
  ]);

  const responders = new Map<string, { name: string; count: number }>();
  for (const policy of policies) {
    const count = (policy.escalation_rules ?? []).reduce((n, rule) => n + (rule.targets?.length ?? 0), 0);
    responders.set(policy.id, { name: policy.name, count });
  }

  return services.map((service) => {
    const ref = service.escalation_policy;
    const known = ref ? responders.get(ref.id) : undefined;
    return {
      id: service.id,
      name: service.name,
      escalationPolicy: ref
        ? { id: ref.id, name: known?.name ?? ref.summary ?? ref.name ?? ref.id, responderCount: known?.count ?? 0 }
        : undefined,
    };
  });
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

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  let services: PagerDutyService[];
  try {
    services = await fetchServices(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const report = planPagerDutyDrift(graph, services);
  console.log(formatPagerDutyDrift(report));
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
