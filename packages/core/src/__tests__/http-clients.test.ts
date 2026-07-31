import { afterEach, describe, expect, it, vi } from "vitest";
import { SlackClient } from "../slack/client";
import { PagerDutyClient } from "../pagerduty/client";
import { nextLink, OktaClient, toDirectoryUser } from "../okta/client";
import { PaperclipClient } from "../paperclip/client";

/**
 * These cover the half of each integration that talks to a vendor. The planners are tested
 * against fixtures elsewhere; what's checked here is whether the request shapes and pagination
 * contracts were read correctly, since getting one wrong turns a network mistake into a
 * confident, wrong finding rather than an error.
 */

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface Scripted {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
  /** Substring of the URL this response answers. Needed because `listServices` issues its two
   * requests concurrently, so a purely sequential script would interleave. */
  match?: string;
}

/** Installs a fetch that replays scripted responses and records what it was asked for. */
function fakeFetch(responses: Scripted[]) {
  const calls: Recorded[] = [];
  const used = new Set<number>();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      url: href,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    });
    let index = responses.findIndex((r, n) => !used.has(n) && (!r.match || href.includes(r.match)));
    if (index === -1) index = responses.length - 1;
    else used.add(index);
    const next = responses[index]!;
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { get: (k: string) => next.headers?.[k.toLowerCase()] ?? null },
      json: async () => next.body,
    } as unknown as Response;
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SlackClient", () => {
  it("sends the bearer token and form encoding Slack expects", async () => {
    const calls = fakeFetch([{ body: { ok: true, channels: [] } }]);
    await new SlackClient({ token: "xoxb-1", baseUrl: "https://slack.test/api" }).listChannels();

    expect(calls[0]!.url).toBe("https://slack.test/api/conversations.list");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers.Authorization).toBe("Bearer xoxb-1");
    expect(calls[0]!.headers["Content-Type"]).toContain("application/x-www-form-urlencoded");
  });

  it("follows next_cursor to the end and stops when it empties", async () => {
    const calls = fakeFetch([
      {
        body: {
          ok: true,
          channels: [{ id: "C1", name: "one", topic: { value: "first" } }],
          response_metadata: { next_cursor: "page2" },
        },
      },
      { body: { ok: true, channels: [{ id: "C2", name: "two" }], response_metadata: { next_cursor: "" } } },
    ]);

    const channels = await new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }).listChannels();
    expect(channels).toEqual([
      { id: "C1", name: "one", topic: "first" },
      { id: "C2", name: "two", topic: undefined },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).not.toContain("cursor=");
    expect(calls[1]!.body).toContain("cursor=page2");
  });

  it("treats an empty topic string as no topic, so it isn't compared as one", async () => {
    fakeFetch([{ body: { ok: true, channels: [{ id: "C1", name: "one", topic: { value: "" } }] } }]);
    const [channel] = await new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }).listChannels();
    expect(channel!.topic).toBeUndefined();
  });

  // Slack answers 200 with ok:false. A transport-only check would read invalid_auth as an empty
  // workspace, and every declared channel would come back as 'missing'.
  it("throws on ok:false even though the HTTP status is 200", async () => {
    fakeFetch([{ status: 200, body: { ok: false, error: "invalid_auth" } }]);
    await expect(new SlackClient({ token: "bad", baseUrl: "https://slack.test/api" }).listChannels()).rejects.toThrow(
      "Slack conversations.list failed: invalid_auth",
    );
  });

  it("throws on a transport error too", async () => {
    fakeFetch([{ status: 500, body: {} }]);
    await expect(new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }).listChannels()).rejects.toThrow(
      /conversations\.list failed: 500/,
    );
  });

  it("posts the channel and topic when setting one", async () => {
    const calls = fakeFetch([{ body: { ok: true } }]);
    await new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }).setTopic("C1", "Owned by checkout");

    expect(calls[0]!.url).toBe("https://slack.test/api/conversations.setTopic");
    const sent = new URLSearchParams(calls[0]!.body!);
    expect(sent.get("channel")).toBe("C1");
    expect(sent.get("topic")).toBe("Owned by checkout");
  });
});

describe("PagerDutyClient", () => {
  const services = (more = false, items = [{ id: "S1", name: "checkout-api", escalation_policy: { id: "P1" } }]) => ({
    body: { services: items, more },
    match: "/services",
  });
  const policies = (
    more = false,
    items = [{ id: "P1", name: "checkout on-call", escalation_rules: [{ targets: [{}, {}] }] }],
  ) => ({
    body: { escalation_policies: items, more },
    match: "/escalation_policies",
  });

  it("sends the Token scheme and versioned Accept header", async () => {
    const calls = fakeFetch([services(), policies()]);
    await new PagerDutyClient({ token: "pd-1", baseUrl: "https://pd.test" }).listServices();

    expect(calls[0]!.headers.Authorization).toBe("Token token=pd-1");
    expect(calls[0]!.headers.Accept).toBe("application/vnd.pagerduty+json;version=2");
  });

  it("counts responders across every escalation rule", async () => {
    fakeFetch([
      services(),
      policies(false, [
        { id: "P1", name: "checkout on-call", escalation_rules: [{ targets: [{}] }, { targets: [{}, {}] }] },
      ]),
    ]);
    const [service] = await new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }).listServices();
    expect(service!.escalationPolicy).toEqual({ id: "P1", name: "checkout on-call", responderCount: 3 });
  });

  // this is the finding that blocks a build, so it has to survive the round trip intact
  it("reports zero responders for a policy with no targets", async () => {
    fakeFetch([services(), policies(false, [{ id: "P1", name: "empty", escalation_rules: [{ targets: [] }] }])]);
    const [service] = await new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }).listServices();
    expect(service!.escalationPolicy!.responderCount).toBe(0);
  });

  it("leaves the policy undefined when a service has none", async () => {
    fakeFetch([{ body: { services: [{ id: "S1", name: "orphan" }], more: false }, match: "/services" }, policies()]);
    const [service] = await new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }).listServices();
    expect(service!.escalationPolicy).toBeUndefined();
  });

  it("advances the offset while `more` is set", async () => {
    const calls = fakeFetch([
      services(true, [{ id: "S1", name: "a", escalation_policy: { id: "P1" } }]),
      services(false, [{ id: "S2", name: "b", escalation_policy: { id: "P1" } }]),
      policies(),
    ]);
    const found = await new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }).listServices();

    expect(found.map((s) => s.name)).toEqual(["a", "b"]);
    expect(calls[0]!.url).toContain("offset=0");
    expect(calls.some((c) => c.url.includes("/services?limit=100&offset=1"))).toBe(true);
  });

  // `more: true` with nothing in the page would otherwise never terminate
  it("stops when a page comes back empty despite `more`", async () => {
    fakeFetch([
      { body: { services: [], more: true }, match: "/services" },
      { body: { escalation_policies: [], more: false }, match: "/escalation_policies" },
    ]);
    const found = await new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }).listServices();
    expect(found).toEqual([]);
  });

  it("throws rather than guessing when the payload isn't the shape documented", async () => {
    fakeFetch([
      { body: { services: "nope" }, match: "/services" },
      { body: { escalation_policies: [], more: false }, match: "/escalation_policies" },
    ]);
    await expect(new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }).listServices()).rejects.toThrow(
      /expected 'services' to be an array/,
    );
  });
});

describe("Okta link-header pagination", () => {
  it("picks next out of a header that also carries self", () => {
    const header =
      '<https://acme.okta.com/api/v1/groups?limit=200>; rel="self", <https://acme.okta.com/api/v1/groups?after=x>; rel="next"';
    expect(nextLink(header)).toBe("https://acme.okta.com/api/v1/groups?after=x");
  });

  it("returns nothing on the last page, which has only self", () => {
    expect(nextLink('<https://acme.okta.com/api/v1/groups>; rel="self"')).toBeUndefined();
    expect(nextLink(null)).toBeUndefined();
  });
});

describe("toDirectoryUser", () => {
  it("prefers email, falls back to login, and builds a name from the parts", () => {
    expect(toDirectoryUser({ status: "ACTIVE", profile: { email: "a@x.com", displayName: "A" } })).toEqual({
      email: "a@x.com",
      displayName: "A",
      status: "ACTIVE",
    });
    expect(toDirectoryUser({ profile: { login: "b@x.com", firstName: "B", lastName: "Cee" } })).toEqual({
      email: "b@x.com",
      displayName: "B Cee",
      status: undefined,
    });
  });

  it("drops a user with no address, since there is nothing to reconcile against", () => {
    expect(toDirectoryUser({ profile: { firstName: "Nameless" } })).toBeNull();
  });
});

describe("OktaClient", () => {
  const group = (id: string, name: string) => ({ id, profile: { name } });
  const user = (email: string, status = "ACTIVE") => ({ status, profile: { email } });

  it("sends the SSWS scheme Okta expects, not a bearer token", async () => {
    const calls = fakeFetch([{ body: [] }]);
    await new OktaClient({ token: "okta-1", url: "https://acme.okta.com" }).listGroups();
    expect(calls[0]!.headers.Authorization).toBe("SSWS okta-1");
  });

  it("strips a trailing slash from the org URL instead of doubling it", async () => {
    const calls = fakeFetch([{ body: [] }]);
    await new OktaClient({ token: "t", url: "https://acme.okta.com/" }).listGroups();
    expect(calls[0]!.url).toBe("https://acme.okta.com/api/v1/groups?limit=200");
  });

  // getting this wrong stops at page one, and everyone past the first 200 looks like a leaver —
  // which is a blocking finding about people who never left
  it("follows the Link header across pages of members", async () => {
    fakeFetch([
      { body: [group("g1", "stream-checkout")] },
      {
        body: [user("one@acme.example")],
        headers: { link: '<https://acme.okta.com/api/v1/groups/g1/users?after=2>; rel="next"' },
      },
      { body: [user("two@acme.example")] },
    ]);

    const groups = await new OktaClient({ token: "t", url: "https://acme.okta.com" }).listGroups();
    expect(groups[0]!.members.map((m) => m.email)).toEqual(["one@acme.example", "two@acme.example"]);
  });

  it("stops if a next link points back at a page already read", async () => {
    const selfReferential = { link: '<https://acme.okta.com/api/v1/groups?limit=200>; rel="next"' };
    fakeFetch([{ body: [group("g1", "team")], headers: selfReferential }]);

    const groups = await new OktaClient({ token: "t", url: "https://acme.okta.com" }).listGroups();
    expect(groups).toHaveLength(1);
  });

  it("skips a group with no name rather than matching it to a team", async () => {
    fakeFetch([{ body: [{ id: "g1", profile: {} }] }]);
    expect(await new OktaClient({ token: "t", url: "https://acme.okta.com" }).listGroups()).toEqual([]);
  });

  it("keeps inactive members, since a deactivated account still listed is the point", async () => {
    fakeFetch([{ body: [group("g1", "stream-checkout")] }, { body: [user("gone@acme.example", "DEPROVISIONED")] }]);
    const groups = await new OktaClient({ token: "t", url: "https://acme.okta.com" }).listGroups();
    expect(groups[0]!.members).toEqual([
      { email: "gone@acme.example", displayName: undefined, status: "DEPROVISIONED" },
    ]);
  });

  it("throws on an error status instead of reporting an empty directory", async () => {
    fakeFetch([{ status: 401, body: {} }]);
    await expect(new OktaClient({ token: "bad", url: "https://acme.okta.com" }).listGroups()).rejects.toThrow(
      /Okta returned 401/,
    );
  });
});

describe("PaperclipClient", () => {
  it("sends a bearer token to the documented company route, url-encoding the id", async () => {
    const calls = fakeFetch([{ body: [] }]);
    await new PaperclipClient({ token: "pc-1", url: "http://pc.test/" }).listAgents("acme co");

    expect(calls[0]!.url).toBe("http://pc.test/api/companies/acme%20co/agents");
    expect(calls[0]!.headers.Authorization).toBe("Bearer pc-1");
  });

  // both shapes appear in Paperclip's docs; reading the wrong one looks like a company with no
  // agents, which reports every declared agent as missing
  it("accepts a bare array and a wrapped one alike", async () => {
    fakeFetch([{ body: [{ id: "a1", name: "One" }] }]);
    expect(await new PaperclipClient({ token: "t", url: "http://pc.test" }).listAgents("c1")).toHaveLength(1);

    fakeFetch([
      {
        body: {
          agents: [
            { id: "a1", name: "One" },
            { id: "a2", name: "Two" },
          ],
        },
      },
    ]);
    expect(await new PaperclipClient({ token: "t", url: "http://pc.test" }).listAgents("c1")).toHaveLength(2);
  });

  it("throws rather than reporting an empty company when the payload is neither", async () => {
    fakeFetch([{ body: { data: "nope" } }]);
    await expect(new PaperclipClient({ token: "t", url: "http://pc.test" }).listAgents("c1")).rejects.toThrow(
      /expected an array of agents/,
    );
  });

  it("classifies the two outcomes a user can act on, instead of throwing both", async () => {
    fakeFetch([{ status: 401, body: {} }]);
    expect(await new PaperclipClient({ token: "bad", url: "http://pc.test" }).verify("c1")).toBe("unauthorized");

    fakeFetch([{ status: 404, body: {} }]);
    expect(await new PaperclipClient({ token: "t", url: "http://pc.test" }).verify("nope")).toBe("no-such-company");

    fakeFetch([{ body: [] }]);
    expect(await new PaperclipClient({ token: "t", url: "http://pc.test" }).verify("c1")).toBe("ok");
  });

  it("still throws on a status it can't interpret", async () => {
    fakeFetch([{ status: 500, body: {} }]);
    await expect(new PaperclipClient({ token: "t", url: "http://pc.test" }).verify("c1")).rejects.toThrow(
      /Paperclip returned 500/,
    );
  });
});
