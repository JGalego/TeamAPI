import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import { buildServer } from "../server";
import { bearerToken, tokenMatches } from "../plugins/auth";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

const TOKEN = "s3cret-token";

let store: OrgGraphStore;

beforeAll(async () => {
  store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
});

const secured = () => buildServer(store, { apiToken: TOKEN });

describe("bearer token auth", () => {
  it("leaves the API open when no token is configured", async () => {
    const app = await buildServer(store);
    expect((await app.inject({ method: "GET", url: "/teams" })).statusCode).toBe(200);
  });

  it("401s a request with no Authorization header", async () => {
    const res = await (await secured()).inject({ method: "GET", url: "/teams" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toBe('Bearer realm="teamapi"');
  });

  it("401s a wrong token", async () => {
    const app = await secured();
    const res = await app.inject({ method: "GET", url: "/teams", headers: { authorization: "Bearer wrong-token" } });
    expect(res.statusCode).toBe(401);
  });

  it("never echoes the presented credential back in the error body", async () => {
    // An error message that reflects the attempted token is how secrets reach log aggregators.
    const app = await secured();
    const res = await app.inject({
      method: "GET",
      url: "/teams",
      headers: { authorization: "Bearer hunter2-please-do-not-log" },
    });
    expect(res.body).not.toContain("hunter2");
  });

  it("accepts the right token", async () => {
    const app = await secured();
    const res = await app.inject({ method: "GET", url: "/teams", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
  });

  it("accepts the scheme case-insensitively, as RFC 7235 requires", async () => {
    const app = await secured();
    const res = await app.inject({ method: "GET", url: "/teams", headers: { authorization: `bearer ${TOKEN}` } });
    expect(res.statusCode).toBe(200);
  });

  it("protects every data route, not just the ones enumerated in a test", async () => {
    const app = await secured();
    const urls = ["/teams", "/services", "/graph", "/search?q=payments", "/gaps", "/dashboard", "/docs"];
    for (const url of urls) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
  });

  it("leaves /health open, so liveness probes still work", async () => {
    const app = await secured();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    // Including with a query string, which probes often add.
    expect((await app.inject({ method: "GET", url: "/health?probe=1" })).statusCode).toBe(200);
  });

  it("does not treat a path merely starting with /health as the health check", async () => {
    const app = await secured();
    expect((await app.inject({ method: "GET", url: "/healthz-internal" })).statusCode).toBe(401);
  });

  it("401s an unknown path, so route existence is not observable without a token", async () => {
    // Fastify runs preParsing for its not-found handler as well as for matched routes, so hooking
    // this stage (rather than onRequest) costs no coverage: an unauthenticated caller cannot tell
    // a real route from an imaginary one.
    const app = await secured();
    expect((await app.inject({ method: "GET", url: "/no-such-route" })).statusCode).toBe(401);
  });

  it("leaves /slack/* to its own HMAC, which Slack can send and a bearer token is not", async () => {
    const app = await buildServer(store, { apiToken: TOKEN, slackSigningSecret: "shh" });
    const res = await app.inject({
      method: "POST",
      url: "/slack/whoowns",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "text=payments-api",
    });
    // Rejected by Slack's signature check (401), not by the bearer hook — the distinction that
    // matters is that it was not rejected for lacking an Authorization header it can never carry.
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });
});

describe("bearerToken", () => {
  it.each([
    ["Bearer abc", "abc"],
    ["bearer abc", "abc"],
    ["  Bearer abc  ", "abc"],
  ])("reads %s", (header, expected) => {
    expect(bearerToken({ headers: { authorization: header } })).toBe(expected);
  });

  it.each([["Basic abc"], ["Bearer"], [""]])("rejects %s", (header) => {
    expect(bearerToken({ headers: { authorization: header } })).toBeUndefined();
  });

  it("returns undefined when the header is absent", () => {
    expect(bearerToken({ headers: {} })).toBeUndefined();
  });
});

describe("tokenMatches", () => {
  it("matches an identical token", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    expect(tokenMatches("abc", "abd")).toBe(false);
  });

  it("rejects a prefix, without throwing on the length mismatch", () => {
    // `timingSafeEqual` throws on unequal lengths; the length guard has to come first.
    expect(tokenMatches("abcdef", "abc")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(tokenMatches("abc", undefined)).toBe(false);
  });
});

describe("CORS", () => {
  it("sends no CORS headers by default", async () => {
    const app = await buildServer(store);
    const res = await app.inject({ method: "GET", url: "/teams", headers: { origin: "https://evil.test" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("allows a configured origin", async () => {
    const app = await buildServer(store, { corsOrigins: ["https://intranet.test"] });
    const res = await app.inject({ method: "GET", url: "/teams", headers: { origin: "https://intranet.test" } });
    expect(res.headers["access-control-allow-origin"]).toBe("https://intranet.test");
  });

  it("does not allow an origin outside the list", async () => {
    const app = await buildServer(store, { corsOrigins: ["https://intranet.test"] });
    const res = await app.inject({ method: "GET", url: "/teams", headers: { origin: "https://evil.test" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("rate limiting", () => {
  it("does not limit by default", async () => {
    const app = await buildServer(store);
    for (let i = 0; i < 12; i++) {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    }
  });

  it("429s past the configured limit", async () => {
    const app = await buildServer(store, { rateLimitPerMinute: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await app.inject({ method: "GET", url: "/teams" })).statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it("counts unauthenticated requests, so a token guess cannot be retried without limit", async () => {
    const app = await buildServer(store, { apiToken: TOKEN, rateLimitPerMinute: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: "GET", url: "/teams", headers: { authorization: "Bearer guess" } });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([401, 401, 429, 429]);
  });
});
