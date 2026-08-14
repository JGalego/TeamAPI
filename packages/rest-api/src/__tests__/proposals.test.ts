import * as path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");
const REPO_ROOT = path.resolve(__dirname, "../../../..");

let plain: FastifyInstance;
let writable: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  plain = await buildServer(store);
  writable = await buildServer(store, {
    proposals: { token: "gh-test", repo: { owner: "acme", repo: "org", rootDir: REPO_ROOT } },
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Answers every GitHub endpoint the proposal flow touches, and records the requests. */
function stubGithub(): Array<{ method: string; url: string; body?: string }> {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ method: init?.method ?? "GET", url, body: init?.body });
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

      if (url.includes("/pulls?")) return json([]);
      // Only the proposal branch is missing; the base branch has to resolve, or `createBranch`
      // has nothing to branch from.
      if (url.includes("/git/ref/heads/teamapi")) return new Response("not found", { status: 404 });
      if (url.includes("/git/ref/heads/")) return json({ object: { sha: "basesha" } });
      if (url.includes("/contents/")) return json({ sha: "filesha" });
      if (url.endsWith("/repos/acme/org")) return json({ default_branch: "main" });
      return json({ number: 12, html_url: "https://github.com/acme/org/pull/12" });
    }),
  );
  return calls;
}

describe("POST /teams/:id/proposals", () => {
  it("is not mounted unless the server was given a repository", async () => {
    const res = await plain.inject({
      method: "POST",
      url: "/teams/stream-checkout/proposals",
      payload: { patch: { info: { focus: "x" } } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("reports itself in /health so a client knows before it offers an edit button", async () => {
    const res = await writable.inject({ method: "GET", url: "/health" });
    expect(res.json().capabilities.proposals).toBe(true);
  });

  it("404s an unknown team before touching GitHub", async () => {
    const calls = stubGithub();
    const res = await writable.inject({
      method: "POST",
      url: "/teams/nope/proposals",
      payload: { patch: { info: { focus: "x" } } },
    });
    expect(res.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("computes the change without writing anything, with dryRun", async () => {
    const calls = stubGithub();
    const res = await writable.inject({
      method: "POST",
      url: "/teams/stream-checkout/proposals",
      payload: { patch: { info: { focus: "Cart, checkout, and refunds" } }, dryRun: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ summary: string[]; content: string; dryRun: boolean }>();
    expect(body.dryRun).toBe(true);
    expect(body.summary.some((line) => line.startsWith("focus:"))).toBe(true);
    expect(body.content).toContain("Cart, checkout, and refunds");
    expect(calls).toHaveLength(0);
  });

  it("opens a pull request and answers with its URL", async () => {
    const calls = stubGithub();
    const res = await writable.inject({
      method: "POST",
      url: "/teams/stream-checkout/proposals",
      payload: { patch: { info: { focus: "Something new" } }, author: "aoife@example.com" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().url).toBe("https://github.com/acme/org/pull/12");
    expect(calls.some((call) => call.method === "PUT" && call.url.includes("/contents/"))).toBe(true);

    const pull = calls.find((call) => call.method === "POST" && call.url.includes("/pulls"));
    expect(pull).toBeDefined();
    // The person who asked for the change is credited, and the summary leads the body — a
    // reviewer looking at a YAML diff needs to know what was meant before reading what moved.
    expect(pull!.body).toContain("aoife@example.com");
  });

  it("rejects a patch that would restructure the graph", async () => {
    const calls = stubGithub();
    for (const patch of [{ interactions: [] }, { id: "renamed" }, { info: { type: "platform" } }]) {
      const res = await writable.inject({
        method: "POST",
        url: "/teams/stream-checkout/proposals",
        payload: { patch },
      });
      expect(res.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("rejects a change that would not validate", async () => {
    const res = await writable.inject({
      method: "POST",
      url: "/teams/stream-checkout/proposals",
      payload: { patch: { cognitiveLoad: { intrinsic: 42, extraneous: 1, germane: 1 } } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("answers 502 when GitHub refuses, not 500", async () => {
    // The request was fine and this server worked; a 500 would send somebody to read these logs
    // instead of the response that names the cause.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("insufficient permissions", { status: 403 })),
    );
    const res = await writable.inject({
      method: "POST",
      url: "/teams/stream-checkout/proposals",
      payload: { patch: { info: { focus: "Another focus" } } },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain("403");
  });
});
