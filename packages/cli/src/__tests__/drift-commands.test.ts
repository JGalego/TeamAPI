import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPagerDutyDrift } from "../commands/pagerduty-drift";
import { runOktaDrift } from "../commands/okta-drift";
import { runSlackSync } from "../commands/slack-sync";

/**
 * The command bodies, over a stubbed fetch. `main.test.ts` mocks these modules to test argument
 * parsing, so without this the exit codes CI gates on were never actually executed.
 */

const ACME = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

function respond(route: (url: string) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  vi.stubGlobal("fetch", async (url: string) => {
    const { status = 200, body, headers = {} } = route(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "Error",
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    } as unknown as Response;
  });
}

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
  delete process.env.PAGERDUTY_TOKEN;
  delete process.env.OKTA_TOKEN;
  delete process.env.SLACK_BOT_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runPagerDutyDrift", () => {
  const page = (key: string, items: unknown[]) => ({ body: { [key]: items, more: false } });

  it("refuses to run without a token, before making any request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await runPagerDutyDrift([ACME], {})).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("A PagerDuty token is required");
  });

  it("takes the token from the environment when no flag is given", async () => {
    process.env.PAGERDUTY_TOKEN = "from-env";
    respond((url) => (url.includes("/services") ? page("services", []) : page("escalation_policies", [])));
    expect(await runPagerDutyDrift([ACME], {})).toBe(0);
  });

  it("exits 0 when every declared service escalates to someone", async () => {
    const named = ["checkout-api", "payments-api", "ledger", "onboarding-api"];
    respond((url) =>
      url.includes("/escalation_policies")
        ? page("escalation_policies", [{ id: "P1", name: "stream-checkout platform-payments stream-onboarding", escalation_rules: [{ targets: [{}] }] }])
        : page("services", named.map((name, i) => ({ id: `S${i}`, name, escalation_policy: { id: "P1" } }))),
    );

    const code = await runPagerDutyDrift([ACME], { token: "t", url: "https://pd.test" });
    expect(logs.join("\n")).toContain("service(s) matched");
    expect(code).toBe(0);
  });

  it("exits 1 when a declared service pages nobody", async () => {
    respond((url) =>
      url.includes("/escalation_policies")
        ? page("escalation_policies", [{ id: "P1", name: "stream-checkout", escalation_rules: [{ targets: [] }] }])
        : page("services", [{ id: "S1", name: "checkout-api", escalation_policy: { id: "P1" } }]),
    );

    expect(await runPagerDutyDrift([ACME], { token: "t", url: "https://pd.test" })).toBe(1);
    expect(logs.join("\n")).toContain("! unresponsive:");
  });

  it("exits 1 and reports the failure when PagerDuty rejects the token", async () => {
    respond(() => ({ status: 401, body: {} }));
    expect(await runPagerDutyDrift([ACME], { token: "bad", url: "https://pd.test" })).toBe(1);
    expect(logs.join("\n")).toContain("PagerDuty returned 401");
  });

  it("exits 1 when nothing matches the patterns", async () => {
    expect(await runPagerDutyDrift(["no/such/**"], { token: "t" })).toBe(1);
    expect(logs.join("\n")).toContain("No files matched");
  });
});

describe("runOktaDrift", () => {
  const activeMembers = (emails: string[]) => emails.map((email) => ({ status: "ACTIVE", profile: { email } }));

  it("refuses to run without a token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await runOktaDrift([ACME], { url: "https://acme.okta.com" })).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exits 0 when the directory agrees with the spec", async () => {
    respond((url) => {
      if (url.includes("/groups/")) {
        return { body: activeMembers(["diego.alves@acme.example", "yuki.tanaka@acme.example", "fatima.al-sayed@acme.example"]) };
      }
      return { body: [{ id: "g1", profile: { name: "stream-checkout" } }] };
    });

    // other teams have no group, which is a warning rather than a failure
    expect(await runOktaDrift([ACME], { token: "t", url: "https://acme.okta.com" })).toBe(0);
  });

  it("exits 1 when a deactivated account is still listed on a team", async () => {
    respond((url) => {
      if (url.includes("/groups/")) {
        return {
          body: [
            { status: "DEPROVISIONED", profile: { email: "diego.alves@acme.example" } },
            ...activeMembers(["yuki.tanaka@acme.example", "fatima.al-sayed@acme.example"]),
          ],
        };
      }
      return { body: [{ id: "g1", profile: { name: "stream-checkout" } }] };
    });

    expect(await runOktaDrift([ACME], { token: "t", url: "https://acme.okta.com" })).toBe(1);
    expect(logs.join("\n")).toContain("! deactivated:");
  });

  it("passes --group-prefix through, so prefixed groups still match", async () => {
    respond((url) => {
      if (url.includes("/groups/")) {
        return { body: activeMembers(["diego.alves@acme.example", "yuki.tanaka@acme.example", "fatima.al-sayed@acme.example"]) };
      }
      return { body: [{ id: "g1", profile: { name: "eng-stream-checkout" } }] };
    });

    await runOktaDrift([ACME], { token: "t", url: "https://acme.okta.com", groupPrefix: "eng-" });
    expect(logs.join("\n")).not.toContain("no directory group matches 'stream-checkout'");
  });

  it("exits 1 and says so when Okta rejects the token", async () => {
    respond(() => ({ status: 401, body: {} }));
    expect(await runOktaDrift([ACME], { token: "bad", url: "https://acme.okta.com" })).toBe(1);
    expect(logs.join("\n")).toContain("Okta returned 401");
  });
});

describe("runSlackSync", () => {
  it("refuses to run without a token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await runSlackSync([ACME], {})).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("A Slack bot token is required");
  });

  it("prints the plan and stops without --yes", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      posts.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, channels: [{ id: "C1", name: "stream-checkout" }] }),
      } as unknown as Response;
    });

    expect(await runSlackSync([ACME], { token: "t" })).toBe(0);
    expect(logs.join("\n")).toContain("Re-run with --yes");
    expect(posts.some((u) => u.includes("setTopic"))).toBe(false);
  });

  it("sets the topic once when --yes is given", async () => {
    const setTopics: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("setTopic")) setTopics.push(String(init?.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, channels: [{ id: "C1", name: "stream-checkout" }] }),
      } as unknown as Response;
    });

    expect(await runSlackSync([ACME], { token: "t", yes: true })).toBe(0);
    expect(setTopics).toHaveLength(1);
    const sent = new URLSearchParams(setTopics[0]!);
    expect(sent.get("channel")).toBe("C1");
    expect(sent.get("topic")).toContain("Stream Checkout");
    expect(logs.join("\n")).toContain("Applied.");
  });

  it("exits 1 when Slack rejects the token, rather than reading it as an empty workspace", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: "invalid_auth" }),
    }) as unknown as Response);

    expect(await runSlackSync([ACME], { token: "bad" })).toBe(1);
    expect(logs.join("\n")).toContain("invalid_auth");
  });
});
