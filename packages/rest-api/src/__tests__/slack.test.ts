import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { slackSignature, verifySlackRequest } from "../routes/slack";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
const SECRET = "test-signing-secret";

let app: FastifyInstance;

/** A request signed the way Slack signs one. */
function signed(text: string, opts: { secret?: string; skewSeconds?: number } = {}) {
  const body = new URLSearchParams({ command: "/whoowns", text, user_name: "ada" }).toString();
  const ts = String(Math.floor(Date.now() / 1000) + (opts.skewSeconds ?? 0));
  return {
    method: "POST" as const,
    url: "/slack/whoowns",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": ts,
      "x-slack-signature": slackSignature(opts.secret ?? SECRET, ts, body),
    },
    payload: body,
  };
}

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  app = await buildServer(store, { slackSigningSecret: SECRET });
});

afterAll(async () => {
  await app.close();
});

describe("verifySlackRequest", () => {
  const body = "text=checkout-api";
  const now = 1_700_000_000;

  it("accepts a correctly signed, fresh request", () => {
    const ts = String(now);
    expect(verifySlackRequest(SECRET, slackSignature(SECRET, ts, body), ts, body, now)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    const ts = String(now);
    expect(verifySlackRequest(SECRET, slackSignature("other", ts, body), ts, body, now)).toBe(false);
  });

  it("rejects a signature over a different body — the point of signing it", () => {
    const ts = String(now);
    const sig = slackSignature(SECRET, ts, body);
    expect(verifySlackRequest(SECRET, sig, ts, "text=something-else", now)).toBe(false);
  });

  it("rejects a replay older than five minutes, in either direction", () => {
    const stale = String(now - 301);
    expect(verifySlackRequest(SECRET, slackSignature(SECRET, stale, body), stale, body, now)).toBe(false);
    const future = String(now + 301);
    expect(verifySlackRequest(SECRET, slackSignature(SECRET, future, body), future, body, now)).toBe(false);
  });

  it("rejects missing or malformed headers rather than throwing", () => {
    expect(verifySlackRequest(SECRET, undefined, String(now), body, now)).toBe(false);
    expect(verifySlackRequest(SECRET, "v0=abc", undefined, body, now)).toBe(false);
    expect(verifySlackRequest(SECRET, "v0=abc", "not-a-number", body, now)).toBe(false);
  });
});

describe("POST /slack/whoowns", () => {
  it("answers with the owning team, its focus and its channel", async () => {
    const res = await app.inject(signed("checkout-api"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ response_type: "ephemeral" });
    expect(res.json().text).toContain("owned by *Stream Checkout* (`stream-checkout`)");
    expect(res.json().text).toContain("Ask in #stream-checkout.");
  });

  it("answers for a service owned by another team in the graph", async () => {
    const res = await app.inject(signed("payments-api"));
    expect(res.json().text).toContain("*Platform Payments*");
  });

  it("lists what is declared when the service is unknown", async () => {
    const res = await app.inject(signed("nope-api"));
    expect(res.json().text).toContain("No service called `nope-api`");
    expect(res.json().text).toContain("`checkout-api`");
  });

  it("explains itself when called with no argument", async () => {
    const res = await app.inject(signed("   "));
    expect(res.json().text).toContain("Usage: `/whoowns <service>`");
  });

  it("rejects an unsigned request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/slack/whoowns",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "text=checkout-api",
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request signed with the wrong secret", async () => {
    const res = await app.inject(signed("checkout-api", { secret: "wrong" }));
    expect(res.statusCode).toBe(401);
  });

  it("rejects a stale request", async () => {
    const res = await app.inject(signed("checkout-api", { skewSeconds: -400 }));
    expect(res.statusCode).toBe(401);
  });
});

describe("the route is not mounted without a secret", () => {
  it("404s rather than serving an unauthenticated command endpoint", async () => {
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    await store.load();
    const bare = await buildServer(store, { slackSigningSecret: "" });
    const res = await bare.inject({ method: "POST", url: "/slack/whoowns", payload: "" });
    expect(res.statusCode).toBe(404);
    await bare.close();
  });
});
