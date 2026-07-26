import { afterEach, describe, expect, it, vi } from "vitest";
import { OktaClient } from "../okta/client";
import { PagerDutyClient } from "../pagerduty/client";
import { PaperclipClient } from "../paperclip/client";
import { SlackClient } from "../slack/client";
import {
  doctorOkta,
  doctorPagerDuty,
  doctorPaperclip,
  doctorSlack,
  formatDoctorReport,
  reportFailed,
  type DoctorReport,
} from "../doctor";

/** Route a fake fetch by URL, honouring the page size the caller asked for. */
function serve(handler: (url: string, params: URLSearchParams) => { status?: number; body: unknown; headers?: Record<string, string> }) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const href = String(url);
    const params = new URLSearchParams(
      typeof init?.body === "string" ? init.body : href.includes("?") ? href.slice(href.indexOf("?") + 1) : "",
    );
    const { status = 200, body, headers = {} } = handler(href, params);
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      json: async () => body,
    } as unknown as Response;
  });
}

const status = (report: DoctorReport, name: string) => report.checks.find((c) => c.name === name)!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("doctorSlack", () => {
  /** A workspace of `count` channels that honours `limit`/`cursor` properly. */
  function workspace(count: number) {
    const all = Array.from({ length: count }, (_, i) => ({ id: `C${i}`, name: `chan-${i}` }));
    serve((url, params) => {
      if (url.endsWith("auth.test")) return { body: { ok: true, team: "Acme", user: "teamapi" } };
      const limit = Number(params.get("limit") ?? 200);
      const from = Number(params.get("cursor") ?? 0);
      const page = all.slice(from, from + limit);
      const next = from + limit < all.length ? String(from + limit) : "";
      return { body: { ok: true, channels: page, response_metadata: { next_cursor: next } } };
    });
  }

  it("passes every check against a healthy workspace", async () => {
    workspace(3);
    const report = await doctorSlack(new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }));
    expect(report.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(status(report, "authenticate").detail).toBe("workspace Acme as teamapi");
    expect(status(report, "pagination").detail).toContain("followed to 3 item(s) at one per page");
  });

  // the failure this whole command exists for: a rejected token that would otherwise read as an
  // empty workspace and turn every declared channel into a 'missing' finding
  it("fails on authentication and doesn't pretend the rest ran", async () => {
    serve(() => ({ body: { ok: false, error: "invalid_auth" } }));
    const report = await doctorSlack(new SlackClient({ token: "bad", baseUrl: "https://slack.test/api" }));

    expect(status(report, "authenticate")).toMatchObject({ status: "fail" });
    expect(status(report, "authenticate").detail).toContain("invalid_auth");
    expect(status(report, "list channels")).toMatchObject({
      status: "skip",
      detail: "not run: authentication failed",
    });
    expect(reportFailed(report)).toBe(true);
  });

  it("skips the pagination check rather than claiming a pass it hasn't earned", async () => {
    workspace(1);
    const report = await doctorSlack(new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }));
    expect(status(report, "pagination")).toMatchObject({
      status: "skip",
      detail: "only 1 item(s) — nothing to page through",
    });
  });

  it("catches a server that ignores the cursor and never advances", async () => {
    const all = Array.from({ length: 3 }, (_, i) => ({ id: `C${i}`, name: `chan-${i}` }));
    serve((url, params) => {
      if (url.endsWith("auth.test")) return { body: { ok: true, team: "Acme", user: "teamapi" } };
      const limit = Number(params.get("limit") ?? 200);
      // deliberately broken: reports no next page even when it truncated
      return { body: { ok: true, channels: all.slice(0, limit), response_metadata: { next_cursor: "" } } };
    });

    const report = await doctorSlack(new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }));
    expect(status(report, "pagination")).toMatchObject({ status: "fail" });
    expect(status(report, "pagination").detail).toContain("returned 1 of 3");
  });

  it("reports a channel missing an id rather than passing it downstream", async () => {
    serve((url) =>
      url.endsWith("auth.test")
        ? { body: { ok: true, team: "Acme", user: "teamapi" } }
        : { body: { ok: true, channels: [{ id: "", name: "nameless" }] } },
    );
    const report = await doctorSlack(new SlackClient({ token: "t", baseUrl: "https://slack.test/api" }));
    expect(status(report, "channel shape")).toMatchObject({ status: "fail" });
  });
});

describe("doctorPagerDuty", () => {
  function account(services: unknown[], policies: unknown[]) {
    serve((url, params) => {
      const limit = Number(params.get("limit") ?? 100);
      const offset = Number(params.get("offset") ?? 0);
      const slice = (all: unknown[], key: string) => ({
        body: { [key]: all.slice(offset, offset + limit), more: offset + limit < all.length },
      });
      if (url.includes("/abilities")) return { body: { abilities: ["sso", "teams"], more: false } };
      if (url.includes("/escalation_policies")) return slice(policies, "escalation_policies");
      return slice(services, "services");
    });
  }

  it("passes against an account whose services all escalate somewhere", async () => {
    account(
      [
        { id: "S1", name: "a", escalation_policy: { id: "P1" } },
        { id: "S2", name: "b", escalation_policy: { id: "P1" } },
      ],
      [{ id: "P1", name: "on-call", escalation_rules: [{ targets: [{}] }] }],
    );
    const report = await doctorPagerDuty(new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }));
    expect(report.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(status(report, "escalation policies").detail).toBe("2/2 service(s) resolved a policy");
  });

  // if no policy resolves, every responder count is zero and the blocking finding fires for
  // everything — a wrong build failure rather than a wrong pass
  it("fails when no service resolves a policy", async () => {
    account([{ id: "S1", name: "a" }], []);
    const report = await doctorPagerDuty(new PagerDutyClient({ token: "t", baseUrl: "https://pd.test" }));
    expect(status(report, "escalation policies")).toMatchObject({ status: "fail" });
    expect(status(report, "escalation policies").detail).toContain("would always read as zero");
  });

  it("fails authentication cleanly when the key is rejected", async () => {
    serve(() => ({ status: 401, body: {} }));
    const report = await doctorPagerDuty(new PagerDutyClient({ token: "bad", baseUrl: "https://pd.test" }));
    expect(status(report, "authenticate")).toMatchObject({ status: "fail" });
    expect(reportFailed(report)).toBe(true);
  });
});

describe("doctorOkta", () => {
  function directory(groups: Array<{ id: string; name: string; members: string[] }>) {
    serve((url, params) => {
      if (url.includes("/api/v1/org")) return { body: { companyName: "Acme Inc" } };
      const limit = Number(params.get("limit") ?? 200);
      const after = Number(params.get("after") ?? 0);

      if (url.includes("/groups/")) {
        const id = url.split("/groups/")[1]!.split("/")[0]!;
        const members = groups.find((g) => g.id === id)!.members;
        return { body: members.slice(after, after + limit).map((email) => ({ status: "ACTIVE", profile: { email } })) };
      }
      const page = groups.slice(after, after + limit);
      const headers =
        after + limit < groups.length
          ? { link: `<https://acme.okta.com/api/v1/groups?limit=${limit}&after=${after + limit}>; rel="next"` }
          : {};
      return { body: page.map((g) => ({ id: g.id, profile: { name: g.name } })), headers };
    });
  }

  it("passes against a directory with addressable members", async () => {
    directory([
      { id: "g1", name: "stream-checkout", members: ["a@acme.example"] },
      { id: "g2", name: "platform-payments", members: ["b@acme.example"] },
    ]);
    const report = await doctorOkta(new OktaClient({ token: "t", url: "https://acme.okta.com" }));
    expect(report.checks.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(status(report, "authenticate").detail).toBe("Acme Inc");
    expect(status(report, "pagination").detail).toContain("followed to 2 item(s)");
  });

  // matching is by address, so a directory that returns none makes every declared member a leaver
  it("fails when no group has a member with an address", async () => {
    directory([{ id: "g1", name: "stream-checkout", members: [] }]);
    const report = await doctorOkta(new OktaClient({ token: "t", url: "https://acme.okta.com" }));
    expect(status(report, "member addresses")).toMatchObject({ status: "fail" });
    expect(status(report, "member addresses").detail).toContain("would read as a leaver");
  });

  it("fails authentication rather than reporting an empty directory", async () => {
    serve(() => ({ status: 401, body: {} }));
    const report = await doctorOkta(new OktaClient({ token: "bad", url: "https://acme.okta.com" }));
    expect(status(report, "authenticate")).toMatchObject({ status: "fail" });
    expect(status(report, "list groups").status).toBe("skip");
  });
});

describe("doctorPaperclip", () => {
  function company(status: number, body: unknown) {
    serve(() => ({ status, body }));
  }

  it("passes and reports how many agents the generator created", async () => {
    company(200, {
      agents: [
        { id: "a1", name: "Docs Writer", metadata: { teamapi: { team: "platform-payments" } } },
        { id: "a2", name: "Hand Made" },
      ],
    });
    const report = await doctorPaperclip(new PaperclipClient({ token: "t", url: "http://pc.test" }), "c1");
    expect(status(report, "authenticate")).toMatchObject({ status: "pass", detail: "company c1 reachable" });
    expect(status(report, "team attribution").detail).toBe(
      "1/2 carry metadata.teamapi; the rest fall back to slug matching",
    );
  });

  it("accepts a bare array as well as a wrapped one, since both appear in the docs", async () => {
    company(200, [{ id: "a1", name: "Docs Writer", metadata: { teamapi: { team: "t" } } }]);
    const report = await doctorPaperclip(new PaperclipClient({ token: "t", url: "http://pc.test" }), "c1");
    expect(status(report, "list agents").detail).toBe("1 agent(s) running");
    expect(status(report, "team attribution").detail).toBe("all 1 agent(s) carry metadata.teamapi");
  });

  // a refused token and a mistyped company id need completely different fixes, and both would
  // otherwise arrive as an indistinguishable thrown error
  it("tells a refused token apart from a company that isn't there", async () => {
    company(401, {});
    let report = await doctorPaperclip(new PaperclipClient({ token: "bad", url: "http://pc.test" }), "c1");
    expect(status(report, "authenticate").detail).toContain("token refused");

    company(404, {});
    report = await doctorPaperclip(new PaperclipClient({ token: "t", url: "http://pc.test" }), "nope");
    expect(status(report, "authenticate").detail).toBe("no company 'nope' at this URL");
    expect(status(report, "list agents").status).toBe("skip");
  });

  it("is honest that there is no pagination it can verify", async () => {
    company(200, []);
    const report = await doctorPaperclip(new PaperclipClient({ token: "t", url: "http://pc.test" }), "c1");
    expect(status(report, "pagination")).toMatchObject({
      status: "skip",
      detail: "the agents route is read in one request; Paperclip documents no cursor",
    });
  });
});

describe("formatDoctorReport", () => {
  it("marks each status and counts only the failures", () => {
    const out = formatDoctorReport({
      integration: "slack",
      checks: [
        { name: "authenticate", status: "pass", detail: "workspace Acme" },
        { name: "list channels", status: "fail", detail: "boom" },
        { name: "pagination", status: "skip", detail: "nothing to page" },
      ],
    });
    expect(out).toContain("✓ authenticate");
    expect(out).toContain("✗ list channels");
    expect(out).toContain("– pagination");
    expect(out).toContain("1 check(s) failed.");
  });

  it("says so when everything passed", () => {
    const out = formatDoctorReport({
      integration: "okta",
      checks: [{ name: "authenticate", status: "pass", detail: "Acme Inc" }],
    });
    expect(out).toContain("All checks passed.");
  });
});
