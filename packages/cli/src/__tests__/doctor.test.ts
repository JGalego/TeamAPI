import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../commands/doctor";

/** The command body: token resolution, the arguments each provider needs, and the exit code. */

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a) => void logs.push(a.join(" ")));
  for (const key of ["GITHUB_TOKEN", "GH_TOKEN", "SLACK_BOT_TOKEN", "PAGERDUTY_TOKEN", "OKTA_TOKEN"]) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function ok(body: unknown) {
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response);
}

describe("runDoctor", () => {
  it("names the environment variable the user is missing", async () => {
    expect(await runDoctor("pagerduty", {})).toBe(1);
    expect(logs.join("\n")).toContain("set PAGERDUTY_TOKEN");
  });

  it("names both variables where a provider accepts either", async () => {
    expect(await runDoctor("github", { org: "acme" })).toBe(1);
    expect(logs.join("\n")).toContain("set GITHUB_TOKEN/GH_TOKEN");
  });

  it("reads the token from the environment", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-env";
    ok({ ok: true, team: "Acme", user: "teamapi", channels: [] });
    expect(await runDoctor("slack", { url: "https://slack.test/api" })).toBe(0);
  });

  it("refuses okta without an org URL, before making a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await runDoctor("okta", { token: "t" })).toBe(1);
    expect(logs.join("\n")).toContain("pass --url https://your-org.okta.com");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses github without an org", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await runDoctor("github", { token: "t" })).toBe(1);
    expect(logs.join("\n")).toContain("pass --org <org>");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exits 0 and prints the report when the checks pass", async () => {
    ok({ ok: true, team: "Acme", user: "teamapi", channels: [] });
    expect(await runDoctor("slack", { token: "t", url: "https://slack.test/api" })).toBe(0);
    expect(logs.join("\n")).toContain("✓ authenticate");
    expect(logs.join("\n")).toContain("All checks passed.");
  });

  it("exits 1 when a check fails", async () => {
    ok({ ok: false, error: "invalid_auth" });
    expect(await runDoctor("slack", { token: "bad", url: "https://slack.test/api" })).toBe(1);
    expect(logs.join("\n")).toContain("✗ authenticate");
    expect(logs.join("\n")).toContain("check(s) failed.");
  });
});
