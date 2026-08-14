import * as path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { OrgGraphStore, type EmbeddingProvider } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

/** Deterministic bag-of-words vectors: the routes' job is to dispatch and report, not to be a
 * model, so a real one here would be testing the vendor. */
const VOCABULARY = ["payment", "checkout", "onboarding", "security", "review", "incident"];
const embeddings: EmbeddingProvider = {
  id: "test#bag-of-words",
  embed: async (texts) => texts.map((text) => VOCABULARY.map((word) => (text.toLowerCase().includes(word) ? 1 : 0))),
};

let plain: FastifyInstance;
let smart: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  plain = await buildServer(store);
  smart = await buildServer(store, { embeddings });
});

describe("GET /search", () => {
  it("defaults to substring matching, with no model needed", async () => {
    const res = await plain.inject({ method: "GET", url: "/search?q=checkout" });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it.each(["hybrid", "semantic"])("refuses mode=%s when no model is configured", async (mode) => {
    // A 400 naming the flag, not a silent fallback: a caller who asked for semantic search and got
    // substring results has no way to tell, and would conclude the feature does not work.
    const res = await plain.inject({ method: "GET", url: `/search?q=checkout&mode=${mode}` });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("--embeddings");
  });

  it("ranks by similarity when a model is configured", async () => {
    const res = await smart.inject({ method: "GET", url: "/search?q=payment&mode=hybrid" });
    expect(res.statusCode).toBe(200);
    const results = res.json<Array<{ matchedBy: string; similarity?: number }>>();
    expect(results.some((result) => result.matchedBy !== "lexical")).toBe(true);
    for (const result of results) {
      if (result.matchedBy !== "lexical") expect(typeof result.similarity).toBe("number");
    }
  });

  it("rejects a mode it does not have", async () => {
    expect((await smart.inject({ method: "GET", url: "/search?q=x&mode=magic" })).statusCode).toBe(400);
  });

  it("paginates semantic results the same way as lexical ones", async () => {
    const res = await smart.inject({ method: "GET", url: "/search?q=payment&mode=hybrid&limit=2" });
    expect(res.json()).toHaveLength(2);
    expect(res.headers["x-total-count"]).toBeDefined();
  });
});

describe("POST /context", () => {
  it("ranks by keyword overlap by default", async () => {
    const res = await plain.inject({ method: "POST", url: "/context", payload: { goal: "review a payment change" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().goal).toBe("review a payment change");
  });

  it("refuses semantic=true when no model is configured", async () => {
    const res = await plain.inject({ method: "POST", url: "/context", payload: { goal: "x", semantic: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("--embeddings");
  });

  it("still reports matchedTerms when similarity did the ranking", async () => {
    // The bundle has to stay explicable. Similarity moving an entry up is fine; an entry appearing
    // with no account of why is not.
    const res = await smart.inject({
      method: "POST",
      url: "/context",
      payload: { goal: "handle a payment incident", semantic: true },
    });
    expect(res.statusCode).toBe(200);
    const bundle = res.json<{ memory: Array<{ matchedTerms: string[] }> }>();
    for (const entry of bundle.memory) expect(Array.isArray(entry.matchedTerms)).toBe(true);
  });

  it("checks the team before spending anything on embeddings", async () => {
    const spy = { id: "spy", embed: vi.fn(async () => []) };
    const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
    await store.load();
    const app = await buildServer(store, { embeddings: spy });

    const res = await app.inject({
      method: "POST",
      url: "/context",
      payload: { goal: "x", teamId: "nope", semantic: true },
    });
    expect(res.statusCode).toBe(404);
    expect(spy.embed).not.toHaveBeenCalled();
  });
});
