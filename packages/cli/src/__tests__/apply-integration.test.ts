import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runApplyIntegration } from "../commands/apply-integration";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
});

const printed = (): string => logSpy.mock.calls.map((args) => String(args[0])).join("\n");
const errored = (): string => errorSpy.mock.calls.map((args) => String(args[0])).join("\n");

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** Routes a stubbed `fetch` by URL substring, and records every request that was made — the point
 * of most of these tests is what was *not* written. */
function stubFetch(routes: Array<[string, unknown]>): { calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? "GET" });
      // Slack posts every method to a distinct path, so matching on the URL covers both styles.
      const match = routes.find(([fragment]) => url.includes(fragment));
      return ok(match ? match[1] : { ok: true });
    }),
  );
  return { calls };
}

describe("runApplyIntegration", () => {
  it("names the variable to set when the target has no token", async () => {
    expect(await runApplyIntegration("slack", [CHECKOUT_SEED], { noConfig: true })).toBe(1);
    expect(errored()).toContain("SLACK_BOT_TOKEN");
  });

  it("returns 1 when no files match", async () => {
    expect(await runApplyIntegration("slack", ["/tmp/nope-*.yml"], { token: "t", noConfig: true })).toBe(1);
    expect(errored()).toContain("No files matched");
  });

  it("requires an Okta URL, since there is no default one to guess", async () => {
    expect(await runApplyIntegration("okta", [CHECKOUT_SEED], { token: "t", noConfig: true })).toBe(1);
    expect(errored()).toContain("Okta org URL");
  });

  describe("slack", () => {
    /** A workspace with one matching account, so there is a change to plan — with nobody
     * resolvable the plan is correctly empty and would prove nothing about --yes. */
    const workspaceWithOneMatch = (): Array<[string, unknown]> => [
      ["usergroups.list", { ok: true, usergroups: [] }],
      ["users.list", { ok: true, members: [{ id: "U1", profile: { email: "diego.alves@acme.example" } }] }],
    ];

    it("prints a plan and writes nothing without --yes", async () => {
      const { calls } = stubFetch(workspaceWithOneMatch());
      expect(await runApplyIntegration("slack", [CHECKOUT_SEED], { token: "t", noConfig: true })).toBe(0);
      expect(printed()).toContain("Re-run with --yes");
      expect(calls.some((call) => call.url.includes("usergroups.create"))).toBe(false);
    });

    it("creates a usergroup and sets its members with --yes", async () => {
      const { calls } = stubFetch([
        ["usergroups.list", { ok: true, usergroups: [] }],
        [
          "users.list",
          {
            ok: true,
            members: [{ id: "U1", profile: { email: "diego.alves@acme.example" } }],
          },
        ],
        ["usergroups.create", { ok: true, usergroup: { id: "S1" } }],
      ]);

      expect(await runApplyIntegration("slack", [CHECKOUT_SEED], { token: "t", yes: true, noConfig: true })).toBe(0);
      expect(calls.some((call) => call.url.includes("usergroups.create"))).toBe(true);
      expect(calls.some((call) => call.url.includes("usergroups.users.update"))).toBe(true);
      expect(printed()).toContain("Applied.");
    });

    it("reports a partial application rather than claiming success", async () => {
      // These APIs have no transaction, so a failure halfway through has already changed things.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("usergroups.list")) return ok({ ok: true, usergroups: [] });
          if (url.includes("users.list")) {
            return ok({ ok: true, members: [{ id: "U1", profile: { email: "diego.alves@acme.example" } }] });
          }
          return ok({ ok: false, error: "ratelimited" });
        }),
      );
      expect(await runApplyIntegration("slack", [CHECKOUT_SEED], { token: "t", yes: true, noConfig: true })).toBe(1);
      expect(errored()).toContain("Some changes may already have been applied");
    });
  });

  describe("okta", () => {
    it("plans a missing group rather than creating one", async () => {
      const { calls } = stubFetch([["/api/v1/groups", []]]);
      expect(
        await runApplyIntegration("okta", [CHECKOUT_SEED], {
          token: "t",
          url: "https://acme.okta.com",
          yes: true,
          noConfig: true,
        }),
      ).toBe(0);
      expect(printed()).toContain("create it by hand");
      // Nothing was written: a directory acquiring a second grouping scheme nobody governs is a
      // worse outcome than a line in a report.
      expect(calls.every((call) => call.method === "GET")).toBe(true);
    });
  });

  describe("pagerduty", () => {
    it("never writes a schedule, and says so in the plan", async () => {
      const { calls } = stubFetch([
        ["/teams?", { teams: [], more: false }],
        ["/users?", { users: [], more: false }],
      ]);
      expect(await runApplyIntegration("pagerduty", [CHECKOUT_SEED], { token: "t", yes: true, noConfig: true })).toBe(
        0,
      );
      expect(printed()).toContain("Schedules and escalation policies are never written");
      expect(calls.some((call) => call.url.includes("schedules"))).toBe(false);
    });
  });
});
