import type { PaperclipAgent } from "../apply/paperclip-drift";

export interface PaperclipClientOptions {
  token: string;
  /** Paperclip base URL, e.g. `http://localhost:3000`. */
  url: string;
}

/** Distinguishes "the token was refused" from "the company doesn't exist" from anything else,
 * because those three need completely different fixes and all look the same as a thrown error. */
export type PaperclipReachability = "ok" | "unauthorized" | "no-such-company";

/**
 * A minimal client over the one Paperclip endpoint `teamapi paperclip-drift` needs.
 *
 * The response is accepted either as a bare array or wrapped in `{ agents }` — both shapes appear
 * in Paperclip's own docs, and guessing wrong would look like a company with no agents, which
 * reports every declared agent as missing.
 */
export class PaperclipClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: PaperclipClientOptions) {
    this.token = options.token;
    this.baseUrl = options.url.replace(/\/+$/, "");
  }

  private agentsUrl(companyId: string): string {
    return `${this.baseUrl}/api/companies/${encodeURIComponent(companyId)}/agents`;
  }

  /** Classifies whether the company is reachable with this token, without throwing on the two
   * outcomes a user can actually act on. */
  async verify(companyId: string): Promise<PaperclipReachability> {
    const res = await fetch(this.agentsUrl(companyId), {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) return "unauthorized";
    if (res.status === 404) return "no-such-company";
    if (!res.ok) throw new Error(`Paperclip returned ${res.status} ${res.statusText} for ${this.agentsUrl(companyId)}`);
    return "ok";
  }

  async listAgents(companyId: string): Promise<PaperclipAgent[]> {
    const url = this.agentsUrl(companyId);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Paperclip returned ${res.status} ${res.statusText} for ${url}`);

    const body = (await res.json()) as unknown;
    const agents = Array.isArray(body) ? body : (body as { agents?: unknown[] }).agents;
    if (!Array.isArray(agents)) {
      throw new Error(`Unexpected response from ${url}: expected an array of agents`);
    }
    return agents as PaperclipAgent[];
  }
}
