import {
  integrationFetch,
  IntegrationError,
  integrationHttpOptions,
  isIntegrationStatus,
  type IntegrationHttpOptions,
} from "../integrations/http";

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

export interface GithubClientOptions extends IntegrationHttpOptions {
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
  private readonly http: IntegrationHttpOptions;

  constructor(options: GithubClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.http = integrationHttpOptions(options);
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
    throw new IntegrationError({
      provider: "GitHub API",
      operation: `${method} ${path}`,
      status: res.status,
      retryable: false,
      message: `GitHub API ${method} ${path} failed: ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`,
    });
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await integrationFetch(
      `${this.baseUrl}${path}`,
      {
        method,
        headers: this.headers(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      { provider: "GitHub API", operation: `${method} ${path}`, ...this.http },
    );
    if (!res.ok) return this.raise(res, method, path);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** The repository's default branch, so a proposal does not have to be told what it is. */
  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const info = await this.request<{ default_branch: string }>("GET", `/repos/${owner}/${repo}`);
    return info.default_branch;
  }

  async getBranchSha(owner: string, repo: string, branch: string): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object.sha;
  }

  async branchExists(owner: string, repo: string, branch: string): Promise<boolean> {
    try {
      await this.getBranchSha(owner, repo, branch);
      return true;
    } catch (error) {
      if (isIntegrationStatus(error, 404)) return false;
      throw error;
    }
  }

  async createBranch(owner: string, repo: string, branch: string, fromSha: string): Promise<void> {
    await this.request("POST", `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: fromSha });
  }

  /** The blob sha of a file on a branch, or undefined when it does not exist there. Required to
   * update a file: GitHub uses it to reject a write computed against content that has since
   * changed, which is exactly the check a proposal needs. */
  async getFileSha(owner: string, repo: string, path: string, ref: string): Promise<string | undefined> {
    try {
      const file = await this.request<{ sha: string }>(
        "GET",
        `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      );
      return file.sha;
    } catch (error) {
      if (isIntegrationStatus(error, 404)) return undefined;
      throw error;
    }
  }

  async putFile(
    owner: string,
    repo: string,
    input: { path: string; branch: string; message: string; content: string; sha?: string },
  ): Promise<void> {
    await this.request("PUT", `/repos/${owner}/${repo}/contents/${input.path}`, {
      message: input.message,
      branch: input.branch,
      content: Buffer.from(input.content, "utf-8").toString("base64"),
      ...(input.sha ? { sha: input.sha } : {}),
    });
  }

  /** An open pull request from `head`, if one is already there. Proposals are idempotent, so this
   * is how a repeated proposal updates its pull request rather than opening a second one. */
  async findPullRequest(
    owner: string,
    repo: string,
    head: string,
  ): Promise<{ number: number; html_url: string } | undefined> {
    const open = await this.request<Array<{ number: number; html_url: string }>>(
      "GET",
      `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`,
    );
    return open[0];
  }

  createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string },
  ): Promise<{ number: number; html_url: string }> {
    return this.request<{ number: number; html_url: string }>("POST", `/repos/${owner}/${repo}/pulls`, input);
  }

  /** The authenticated login. Distinguishes a rejected token from an org with no teams. */
  async verify(): Promise<string> {
    const me = await this.request<{ login: string }>("GET", "/user");
    return `authenticated as ${me.login}`;
  }

  private async paginate<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    const seen = new Set<string>();
    const maxPages = this.http.maxPages ?? 1_000;
    let next: string | undefined = `${this.baseUrl}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
    while (next) {
      if (seen.size >= maxPages || seen.has(next)) {
        throw new IntegrationError({
          provider: "GitHub API",
          operation: `paginate ${path}`,
          message: `GitHub API pagination did not terminate for ${path}`,
        });
      }
      seen.add(next);
      const res: Response = await integrationFetch(
        next,
        { headers: this.headers(false) },
        { provider: "GitHub API", operation: `GET ${next}`, ...this.http },
      );
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

  setTeamMembership(
    org: string,
    teamSlug: string,
    username: string,
    role: "member" | "maintainer" = "member",
  ): Promise<void> {
    return this.request<void>("PUT", `/orgs/${org}/teams/${teamSlug}/memberships/${username}`, { role });
  }

  removeTeamMembership(org: string, teamSlug: string, username: string): Promise<void> {
    return this.request<void>("DELETE", `/orgs/${org}/teams/${teamSlug}/memberships/${username}`);
  }
}
