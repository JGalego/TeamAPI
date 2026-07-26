import type { SlackChannel } from "../apply/slack";

const DEFAULT_BASE_URL = "https://slack.com/api";

export interface SlackClientOptions {
  token: string;
  /** Override for tests or an enterprise proxy; defaults to https://slack.com/api. */
  baseUrl?: string;
}

interface SlackConversation {
  id: string;
  name: string;
  topic?: { value?: string };
}

/**
 * A minimal client over the two Slack Web API methods `teamapi slack-sync` needs.
 *
 * Slack answers 200 with `{ ok: false, error }` rather than an HTTP error code, so every call
 * checks the body — a transport-only check would treat `invalid_auth` as success.
 */
export class SlackClient {
  private readonly token: string;
  private readonly baseUrl: string;

  constructor(options: SlackClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async call<T>(method: string, body: Record<string, string>): Promise<T> {
    const res = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) throw new Error(`Slack ${method} failed: ${res.status} ${res.statusText}`);
    const payload = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!payload.ok) throw new Error(`Slack ${method} failed: ${payload.error ?? "unknown error"}`);
    return payload;
  }

  /** Who the token belongs to. A distinct call from `listChannels` on purpose: without it, an
   * invalid token and an empty workspace are indistinguishable downstream. */
  async verify(): Promise<string> {
    const who = await this.call<{ team?: string; user?: string }>("auth.test", {});
    return `workspace ${who.team ?? "?"} as ${who.user ?? "?"}`;
  }

  /**
   * Public and private channels the token can see, following `next_cursor` to the end.
   *
   * `pageSize` exists so `teamapi doctor` can force pagination with a single channel rather than
   * needing 200 of them.
   */
  async listChannels(pageSize = 200): Promise<SlackChannel[]> {
    const channels: SlackChannel[] = [];
    let cursor = "";
    do {
      const page = await this.call<{
        channels: SlackConversation[];
        response_metadata?: { next_cursor?: string };
      }>("conversations.list", {
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: String(pageSize),
        ...(cursor ? { cursor } : {}),
      });
      for (const c of page.channels) channels.push({ id: c.id, name: c.name, topic: c.topic?.value || undefined });
      cursor = page.response_metadata?.next_cursor ?? "";
    } while (cursor);
    return channels;
  }

  async setTopic(channelId: string, topic: string): Promise<void> {
    await this.call("conversations.setTopic", { channel: channelId, topic });
  }
}
