import type { DirectoryGroup, DirectoryUser } from "../apply/okta-drift";
import {
  integrationFetch,
  integrationHttpOptions,
  IntegrationError,
  type IntegrationHttpOptions,
} from "../integrations/http";

export interface OktaClientOptions extends IntegrationHttpOptions {
  token: string;
  /** Okta org URL, e.g. `https://acme.okta.com`. */
  url: string;
}

interface RawGroup {
  id: string;
  profile?: { name?: string };
}

interface RawUser {
  status?: string;
  profile?: { email?: string; login?: string; displayName?: string; firstName?: string; lastName?: string };
}

/** Okta paginates with `Link: <...>; rel="next"` rather than a cursor in the body. */
export function nextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return undefined;
}

/** `profile.email`, falling back to `login`, which is an address in almost every Okta org. */
export function toDirectoryUser(raw: RawUser): DirectoryUser | null {
  const email = raw.profile?.email ?? raw.profile?.login;
  if (!email) return null;
  const name = raw.profile?.displayName ?? [raw.profile?.firstName, raw.profile?.lastName].filter(Boolean).join(" ");
  return { email, displayName: name || undefined, status: raw.status };
}

/** A minimal client over the two Okta endpoints `teamapi okta-drift` needs. */
export class OktaClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly http: IntegrationHttpOptions;

  constructor(options: OktaClientOptions) {
    this.token = options.token;
    this.baseUrl = options.url.replace(/\/+$/, "");
    this.http = integrationHttpOptions(options);
  }

  private async page<T>(startUrl: string): Promise<T[]> {
    const out: T[] = [];
    const seen = new Set<string>();
    let next: string | undefined = startUrl;

    while (next) {
      // Okta echoes a `self` link alongside `next`; a malformed header that points back at the
      // page we just read would otherwise loop forever
      if (seen.has(next) || seen.size >= (this.http.maxPages ?? 1_000)) {
        throw new IntegrationError({
          provider: "Okta",
          operation: `paginate ${startUrl}`,
          message: `Okta pagination did not terminate for ${startUrl}`,
        });
      }
      seen.add(next);

      const res: Response = await integrationFetch(
        next,
        {
          headers: { Authorization: `SSWS ${this.token}`, Accept: "application/json" },
        },
        { provider: "Okta", operation: `GET ${next}`, ...this.http },
      );
      if (!res.ok) throw new Error(`Okta returned ${res.status} ${res.statusText} for ${next}`);
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error(`Unexpected response from ${next}: expected an array`);
      out.push(...(body as T[]));
      next = nextLink(res.headers.get("link"));
    }
    return out;
  }

  private async write(method: "PUT" | "DELETE", path: string): Promise<void> {
    const res = await integrationFetch(
      `${this.baseUrl}${path}`,
      {
        method,
        headers: { Authorization: `SSWS ${this.token}`, Accept: "application/json" },
      },
      { provider: "Okta", operation: `${method} ${path}`, ...this.http },
    );
    if (!res.ok) throw new Error(`Okta returned ${res.status} ${res.statusText} for ${method} ${path}`);
  }

  /** The org this token belongs to. */
  async verify(): Promise<string> {
    const res = await integrationFetch(
      `${this.baseUrl}/api/v1/org`,
      {
        headers: { Authorization: `SSWS ${this.token}`, Accept: "application/json" },
      },
      { provider: "Okta", operation: "GET /api/v1/org", ...this.http },
    );
    if (!res.ok) throw new Error(`Okta returned ${res.status} ${res.statusText} for /api/v1/org`);
    const org = (await res.json()) as { subdomain?: string; companyName?: string };
    return org.companyName ?? org.subdomain ?? "org reachable";
  }

  /**
   * Every group, with its active and inactive members resolved to addresses.
   *
   * `pageSize` exists so `teamapi doctor` can force the Link-header walk with a couple of groups
   * rather than needing two hundred.
   */
  /** Group ids by name, so a plan built from names can be executed against ids. */
  async listGroupIds(pageSize = 200): Promise<Map<string, string>> {
    const groups = await this.page<RawGroup>(`${this.baseUrl}/api/v1/groups?limit=${pageSize}`);
    return new Map(groups.filter((group) => group.profile?.name).map((group) => [group.profile!.name!, group.id]));
  }

  /** Resolves an address to a user id. Okta's search is eventually consistent, so this uses the
   * exact-match `q` filter and checks the address it got back rather than trusting the first hit. */
  async findUserIdByEmail(email: string): Promise<string | undefined> {
    const users = await this.page<RawUser & { id?: string }>(
      `${this.baseUrl}/api/v1/users?limit=5&search=${encodeURIComponent(`profile.email eq "${email}"`)}`,
    );
    const match = users.find(
      (user) => (user.profile?.email ?? user.profile?.login ?? "").toLowerCase() === email.toLowerCase(),
    );
    return match?.id;
  }

  async addUserToGroup(groupId: string, userId: string): Promise<void> {
    await this.write("PUT", `/api/v1/groups/${groupId}/users/${userId}`);
  }

  async removeUserFromGroup(groupId: string, userId: string): Promise<void> {
    await this.write("DELETE", `/api/v1/groups/${groupId}/users/${userId}`);
  }

  async listGroups(pageSize = 200): Promise<DirectoryGroup[]> {
    const groups = await this.page<RawGroup>(`${this.baseUrl}/api/v1/groups?limit=${pageSize}`);
    const out: DirectoryGroup[] = [];

    for (const group of groups) {
      const name = group.profile?.name;
      if (!name) continue;
      const users = await this.page<RawUser>(`${this.baseUrl}/api/v1/groups/${group.id}/users?limit=${pageSize}`);
      out.push({
        name,
        members: users.map(toDirectoryUser).filter((u): u is DirectoryUser => u !== null),
      });
    }
    return out;
  }
}
