const DEFAULT_BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";

export interface GithubTeam {
  slug: string;
  name: string;
  description: string | null;
}

export interface GithubUser {
  login: string;
}

export interface GithubUserProfile {
  login: string;
  name: string | null;
  email: string | null;
}

export interface GithubRepo {
  name: string;
  html_url: string;
}

export interface GithubClientOptions {
  token: string;
  /** Override for GitHub Enterprise Server; defaults to https://api.github.com. */
  baseUrl?: string;
}

function parseNextLink(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * A minimal, typed client over the GitHub REST endpoints `teamapi apply`/`teamapi import
 * github-org` need — org teams, team membership, and team repos. Deliberately not a general
 * GitHub API wrapper: only what those two commands call.
 */
export class GithubClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: GithubClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  private headers(hasBody: boolean): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    };
  }

  private async raise(res: Response, method: string, path: string): Promise<never> {
    const detail = await res.text().catch(() => "");
    throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return this.raise(res, method, path);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let next: string | undefined = `${this.baseUrl}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (next) {
      const res: Response = await fetch(next, { headers: this.headers(false) });
      if (!res.ok) return this.raise(res, "GET", next);
      results.push(...((await res.json()) as T[]));
      next = parseNextLink(res.headers.get("link"));
    }
    return results;
  }

  listOrgTeams(org: string): Promise<GithubTeam[]> {
    return this.paginate<GithubTeam>(`/orgs/${org}/teams`);
  }

  listTeamMembers(org: string, teamSlug: string): Promise<GithubUser[]> {
    return this.paginate<GithubUser>(`/orgs/${org}/teams/${teamSlug}/members`);
  }

  listTeamRepos(org: string, teamSlug: string): Promise<GithubRepo[]> {
    return this.paginate<GithubRepo>(`/orgs/${org}/teams/${teamSlug}/repos`);
  }

  getUser(login: string): Promise<GithubUserProfile> {
    return this.request<GithubUserProfile>("GET", `/users/${login}`);
  }

  /** Created with `name` set to the desired slug (not a display name) so the resulting team slug
   * is predictable — callers that want a prettier display name can rename it in GitHub afterward. */
  createTeam(org: string, input: { slug: string; description?: string }): Promise<GithubTeam> {
    return this.request<GithubTeam>("POST", `/orgs/${org}/teams`, {
      name: input.slug,
      description: input.description,
      privacy: "closed",
    });
  }

  setTeamMembership(org: string, teamSlug: string, username: string, role: "member" | "maintainer" = "member"): Promise<void> {
    return this.request<void>("PUT", `/orgs/${org}/teams/${teamSlug}/memberships/${username}`, { role });
  }

  removeTeamMembership(org: string, teamSlug: string, username: string): Promise<void> {
    return this.request<void>("DELETE", `/orgs/${org}/teams/${teamSlug}/memberships/${username}`);
  }
}
