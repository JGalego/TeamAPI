import type { PagerDutyService } from "../apply/pagerduty-drift";

const DEFAULT_BASE_URL = "https://api.pagerduty.com";

export interface PagerDutyClientOptions {
  token: string;
  /** Override for the EU service region, or for tests. */
  baseUrl?: string;
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

/**
 * A minimal client over the two PagerDuty endpoints `teamapi pagerduty-drift` needs.
 *
 * Both are paginated with `offset`/`limit` and a `more` flag rather than a cursor, so the loop
 * has to advance the offset itself — and stop if a page ever comes back empty while `more` is
 * still set, which would otherwise spin forever.
 */
export class PagerDutyClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: PagerDutyClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  private async page<T>(path: string, key: string, pageSize = 100): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    for (;;) {
      const url = `${this.baseUrl}${path}?limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Token token=${this.token}`,
          Accept: "application/vnd.pagerduty+json;version=2",
        },
      });
      if (!res.ok) throw new Error(`PagerDuty returned ${res.status} ${res.statusText} for ${url}`);
      const body = (await res.json()) as Record<string, unknown>;
      const items = body[key];
      if (!Array.isArray(items)) {
        throw new Error(`Unexpected response from ${url}: expected '${key}' to be an array`);
      }
      out.push(...(items as T[]));
      if (!body.more || items.length === 0) return out;
      offset += items.length;
    }
  }

  /** Probes the token. PagerDuty API keys are account-scoped, so there is no identity to
   * report — `/abilities` is the documented way to ask whether a key is accepted at all. */
  async verify(): Promise<string> {
    const abilities = await this.page<string>("/abilities", "abilities", 100);
    return `${abilities.length} account ability(ies) visible`;
  }

  /**
   * Services, each resolved to its escalation policy's responder count.
   *
   * Policies are fetched separately because a service only carries a reference to its policy —
   * and the count of people on that policy is the whole point of the check, since a policy with
   * no targets pages nobody.
   */
  async listServices(pageSize = 100): Promise<PagerDutyService[]> {
    const [services, policies] = await Promise.all([
      this.page<RawService>("/services", "services", pageSize),
      this.page<RawPolicy>("/escalation_policies", "escalation_policies", pageSize),
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
          ? {
              id: ref.id,
              name: known?.name ?? ref.summary ?? ref.name ?? ref.id,
              responderCount: known?.count ?? 0,
            }
          : undefined,
      };
    });
  }
}
