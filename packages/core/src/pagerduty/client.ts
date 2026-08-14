import type { PagerDutyService } from "../apply/pagerduty-drift";
import type { PagerDutyTeam, PagerDutyUser } from "../apply/pagerduty-teams";

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

  private async write(method: "PUT" | "DELETE", path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Token token=${this.token}`,
        Accept: "application/vnd.pagerduty+json;version=2",
      },
    });
    if (!res.ok) throw new Error(`PagerDuty returned ${res.status} ${res.statusText} for ${method} ${path}`);
  }

  /** Teams with their members resolved to addresses. Membership is fetched per team, since the
   * team list carries no members — one call each, which is the API's shape rather than a choice. */
  async listTeams(pageSize = 100): Promise<PagerDutyTeam[]> {
    const teams = await this.page<{ id: string; name: string }>("/teams", "teams", pageSize);
    const out: PagerDutyTeam[] = [];
    for (const team of teams) {
      const members = await this.page<{ user?: { id?: string; email?: string } }>(
        `/teams/${team.id}/members`,
        "members",
        pageSize,
      );
      out.push({
        id: team.id,
        name: team.name,
        members: members
          .map((entry) => ({ id: entry.user?.id ?? "", email: entry.user?.email ?? "" }))
          .filter((member) => member.id && member.email),
      });
    }
    return out;
  }

  async listUsers(pageSize = 100): Promise<PagerDutyUser[]> {
    const users = await this.page<{ id: string; email?: string }>("/users", "users", pageSize);
    return users.filter((user) => user.email).map((user) => ({ id: user.id, email: user.email! }));
  }

  /** Adds a user to a team. `role: manager` is deliberately never sent — a sync that promoted
   * somebody to team manager as a side effect of a membership change would be a surprise with
   * permissions attached. */
  async addUserToTeam(teamId: string, userId: string): Promise<void> {
    await this.write("PUT", `/teams/${teamId}/users/${userId}`);
  }

  async removeUserFromTeam(teamId: string, userId: string): Promise<void> {
    await this.write("DELETE", `/teams/${teamId}/users/${userId}`);
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
