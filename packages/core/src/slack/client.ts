import type { SlackChannel } from "../apply/slack";
import type { SlackUser, SlackUsergroup } from "../apply/slack-usergroups";
import {
  integrationFetch,
  IntegrationError,
  integrationHttpOptions,
  type IntegrationHttpOptions,
} from "../integrations/http";

const DEFAULT_BASE_URL = "https://slack.com/api";

export interface SlackClientOptions extends IntegrationHttpOptions {
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
  private readonly http: IntegrationHttpOptions;

  constructor(options: SlackClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.http = integrationHttpOptions(options);
  }

  private async call<T>(method: string, body: Record<string, string>): Promise<T> {
    const res = await integrationFetch(
      `${this.baseUrl}/${method}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
        },
        body: new URLSearchParams(body).toString(),
      },
      { provider: "Slack", operation: method, ...this.http },
    );
    if (!res.ok) throw new Error(`Slack ${method} failed: ${res.status} ${res.statusText}`);
    const payload = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!payload.ok) {
      const code = payload.error ?? "unknown error";
      throw new IntegrationError({
        provider: "Slack",
        operation: method,
        retryable: code === "ratelimited" || code === "internal_error",
        message: `Slack ${method} failed: ${code}`,
      });
    }
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
    const seen = new Set<string>();
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
      for (const c of page.channels) {
        // Slack sends topic.value as "" for a channel with no topic; treat that as absent
        // rather than as a topic that happens to be blank.
        const topic = c.topic?.value;
        channels.push({ id: c.id, name: c.name, topic: topic === "" ? undefined : topic });
      }
      const next = page.response_metadata?.next_cursor ?? "";
      if (next && (seen.has(next) || seen.size >= (this.http.maxPages ?? 1_000))) {
        throw new IntegrationError({
          provider: "Slack",
          operation: "conversations.list",
          message: "Slack conversations.list pagination did not terminate",
        });
      }
      if (next) seen.add(next);
      cursor = next;
    } while (cursor);
    return channels;
  }

  async setTopic(channelId: string, topic: string): Promise<void> {
    await this.call("conversations.setTopic", { channel: channelId, topic });
  }

  /**
   * Every usergroup the token can see, with its current members.
   *
   * `include_users` asks Slack to inline the member list, which turns one call per group into
   * one call for all of them — the difference between a plan taking a second and a plan taking a
   * minute on a workspace with two hundred groups. Disabled groups are included: a team whose
   * usergroup was disabled should show as needing one, not silently as missing.
   */
  async listUsergroups(): Promise<SlackUsergroup[]> {
    const payload = await this.call<{
      usergroups: Array<{ id: string; handle: string; name: string; users?: string[] }>;
    }>("usergroups.list", { include_users: "true", include_disabled: "true" });
    return payload.usergroups.map((group) => ({
      id: group.id,
      handle: group.handle,
      name: group.name,
      userIds: group.users ?? [],
    }));
  }

  /** Workspace members with their addresses, following `next_cursor` to the end. Addresses are
   * the only field a Team API member and a Slack account reliably share. */
  async listUsers(pageSize = 200): Promise<SlackUser[]> {
    const users: SlackUser[] = [];
    const seen = new Set<string>();
    let cursor = "";
    do {
      const page = await this.call<{
        members: Array<{ id: string; deleted?: boolean; is_bot?: boolean; profile?: { email?: string } }>;
        response_metadata?: { next_cursor?: string };
      }>("users.list", { limit: String(pageSize), ...(cursor ? { cursor } : {}) });
      for (const member of page.members) {
        users.push({
          id: member.id,
          email: member.profile?.email,
          deleted: member.deleted,
          isBot: member.is_bot,
        });
      }
      const next = page.response_metadata?.next_cursor ?? "";
      if (next && (seen.has(next) || seen.size >= (this.http.maxPages ?? 1_000))) {
        throw new IntegrationError({
          provider: "Slack",
          operation: "users.list",
          message: "Slack users.list pagination did not terminate",
        });
      }
      if (next) seen.add(next);
      cursor = next;
    } while (cursor);
    return users;
  }

  async createUsergroup(handle: string, name: string, description?: string): Promise<string> {
    const created = await this.call<{ usergroup: { id: string } }>("usergroups.create", {
      handle,
      name,
      ...(description ? { description } : {}),
    });
    return created.usergroup.id;
  }

  /** Replaces a usergroup's membership wholesale, which is the only shape Slack offers — there is
   * no add-one/remove-one endpoint, so the caller has to send the full desired list. */
  async setUsergroupUsers(usergroupId: string, userIds: string[]): Promise<void> {
    await this.call("usergroups.users.update", { usergroup: usergroupId, users: userIds.join(",") });
  }
}
