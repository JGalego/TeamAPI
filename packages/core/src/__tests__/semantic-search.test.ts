import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildSearchDocuments, semanticSearchOrg } from "../search/semantic";
import {
  cosineSimilarity,
  EmbeddingCache,
  OpenAiEmbeddingProvider,
  withEmbeddingCache,
  type EmbeddingProvider,
} from "../search/embeddings";
import { createEmbeddingScorer } from "../search/context-scorer";
import { deriveContextBundle } from "../context-bundle/derive";
import type { OrgGraph } from "../model/org-graph";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
});

/**
 * A deterministic stand-in for a model: every embedding is a bag-of-words vector over a fixed
 * vocabulary.
 *
 * Not an approximation of a real embedding, and not trying to be. What these tests check is the
 * ranking and merging logic around the model, which has to be correct whatever the model does;
 * asserting that a real one places "who charges cards" near a payments service would be testing
 * the vendor. The vocabulary is chosen so a query can share *concepts* with a document without
 * sharing its exact words, which is the one property the substring matcher does not have.
 */
function bagOfWordsEmbeddings(vocabulary: string[]): EmbeddingProvider {
  return {
    id: "test#bag-of-words",
    embed: async (texts) =>
      texts.map((text) => {
        const lower = text.toLowerCase();
        return vocabulary.map((word) => (lower.includes(word) ? 1 : 0));
      }),
  };
}

describe("buildSearchDocuments", () => {
  it("covers every kind the lexical search can return", () => {
    const kinds = new Set(buildSearchDocuments(graph).map((document) => document.kind));
    for (const kind of ["team", "service", "role", "member", "agent", "memory", "policy", "knowledgeBase"]) {
      expect({ kind, present: kinds.has(kind as never) }).toMatchObject({ present: true });
    }
  });

  it("embeds more than the label", () => {
    // A vector of "Checkout Tech Lead" carries almost nothing about what that role does; the
    // responsibilities beneath it carry most of it.
    const role = buildSearchDocuments(graph).find((document) => document.kind === "role")!;
    expect(role.text.length).toBeGreaterThan(role.label.length * 2);
  });

  it("gives every document a team and a non-empty text", () => {
    for (const document of buildSearchDocuments(graph)) {
      expect(graph.teams.has(document.teamId)).toBe(true);
      expect(document.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("semanticSearchOrg", () => {
  const embeddings = bagOfWordsEmbeddings(["payment", "checkout", "onboarding", "platform", "security", "review"]);

  it("finds a service by its exact name, which is what a nearest-neighbour search alone loses", async () => {
    const results = await semanticSearchOrg(graph, "checkout-api", { embeddings });
    const exact = results.find((result) => result.label === "checkout-api");
    expect(exact).toBeDefined();
    // Ranked above every semantic-only result. A search that stopped finding a service by its own
    // name would be a downgrade however good its recall was elsewhere.
    expect(exact!.matchedBy === "lexical" || exact!.matchedBy === "both").toBe(true);
    expect(results.indexOf(exact!)).toBeLessThan(results.findIndex((r) => r.matchedBy === "semantic"));
  });

  it("surfaces a resource sharing no words with the query", async () => {
    // "security" appears in no team name and no service name, so the substring matcher finds it
    // only where it is written verbatim. This is the case embeddings exist for.
    const lexical = await semanticSearchOrg(graph, "security", { embeddings, mode: "lexical" });
    const hybrid = await semanticSearchOrg(graph, "security", { embeddings, mode: "hybrid" });
    expect(hybrid.length).toBeGreaterThan(lexical.length);
    expect(hybrid.some((result) => result.matchedBy === "semantic")).toBe(true);
  });

  it("marks a result found both ways, since that is the strongest signal available", async () => {
    const results = await semanticSearchOrg(graph, "checkout", { embeddings });
    expect(results.some((result) => result.matchedBy === "both")).toBe(true);
  });

  it("returns only substring matches in lexical mode, and embeds nothing", async () => {
    const spy = { id: "spy", embed: vi.fn(async () => []) };
    const results = await semanticSearchOrg(graph, "checkout", { embeddings: spy, mode: "lexical" });
    expect(results.every((result) => result.matchedBy === "lexical")).toBe(true);
    // Lexical mode must not pay for a model it is not using.
    expect(spy.embed).not.toHaveBeenCalled();
  });

  it("returns only similarity matches in semantic mode", async () => {
    const results = await semanticSearchOrg(graph, "checkout", { embeddings, mode: "semantic" });
    expect(results.every((result) => result.matchedBy === "semantic")).toBe(true);
    expect(results.every((result) => typeof result.similarity === "number")).toBe(true);
  });

  it("drops results below the similarity floor", async () => {
    const permissive = await semanticSearchOrg(graph, "payment", { embeddings, mode: "semantic", minSimilarity: 0 });
    const strict = await semanticSearchOrg(graph, "payment", { embeddings, mode: "semantic", minSimilarity: 0.99 });
    expect(strict.length).toBeLessThan(permissive.length);
  });

  it("honours the limit", async () => {
    expect(await semanticSearchOrg(graph, "checkout", { embeddings, limit: 3 })).toHaveLength(3);
  });

  it("returns nothing rather than everything for a query matching nothing", async () => {
    const results = await semanticSearchOrg(graph, "quantum cryptography", { embeddings, minSimilarity: 0.5 });
    expect(results).toEqual([]);
  });
});

describe("createEmbeddingScorer", () => {
  const embeddings = bagOfWordsEmbeddings(["oauth", "payment", "review", "incident", "compliance"]);

  it("keeps a bundle explicable: matchedTerms still says why, even when similarity moved it", async () => {
    const scorer = await createEmbeddingScorer(graph, "handle an incident", { embeddings });
    const bundle = deriveContextBundle(graph, { goal: "handle an incident", scorer });
    for (const entry of [...bundle.memory, ...bundle.knowledgeBase, ...bundle.playbooks]) {
      expect(Array.isArray(entry.matchedTerms)).toBe(true);
    }
  });

  it("surfaces entries keyword overlap alone would have scored zero", async () => {
    const goal = "incident";
    const keywordOnly = deriveContextBundle(graph, { goal });
    const scored = deriveContextBundle(graph, {
      goal,
      scorer: await createEmbeddingScorer(graph, goal, { embeddings }),
    });
    const count = (bundle: typeof keywordOnly): number =>
      bundle.memory.length + bundle.knowledgeBase.length + bundle.playbooks.length + bundle.policies.length;
    expect(count(scored)).toBeGreaterThanOrEqual(count(keywordOnly));
  });

  it("scores an unseen text as zero rather than throwing", async () => {
    const scorer = await createEmbeddingScorer(graph, "anything", { embeddings });
    expect(scorer.score("text no candidate has")).toBe(0);
  });
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 for a zero vector rather than NaN", () => {
    // An empty document should rank last, not poison every comparison it takes part in.
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("OpenAiEmbeddingProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("batches, and reassembles by the response's own index rather than arrival order", async () => {
    // The `index` field exists precisely because order is not guaranteed. Trusting arrival order
    // attaches every document's vector to its neighbour, which no test of the happy path catches.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const sent = JSON.parse(init.body) as { input: string[] };
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            data: sent.input.map((_text, i) => ({ index: i, embedding: [i] })).reverse(),
          }),
          text: async () => "",
        };
      }),
    );
    const provider = new OpenAiEmbeddingProvider({ baseUrl: "https://x/v1", batchSize: 2 });
    expect(await provider.embed(["a", "b", "c"])).toEqual([[0], [1], [0]]);
  });

  it("refuses a response with the wrong number of vectors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ data: [{ index: 0, embedding: [1] }] }),
        text: async () => "",
      })),
    );
    await expect(new OpenAiEmbeddingProvider({ baseUrl: "https://x/v1" }).embed(["a", "b"])).rejects.toThrow(
      "1 vectors for 2 inputs",
    );
  });

  it("puts the server's error body in the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad key" })),
    );
    await expect(new OpenAiEmbeddingProvider({ baseUrl: "https://x/v1" }).embed(["a"])).rejects.toThrow("bad key");
  });
});

describe("withEmbeddingCache", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "teamapi-embed-"));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("embeds a text once across separate wrappers sharing a directory", async () => {
    const inner = { id: "test#model", embed: vi.fn(async (texts: string[]) => texts.map(() => [1, 2, 3])) };
    const cache = new EmbeddingCache(path.join(dir, "shared"));

    expect(await withEmbeddingCache(inner, cache).embed(["hello"])).toEqual([[1, 2, 3]]);
    // A separate wrapper, so the in-memory half cannot be what answers.
    expect(await withEmbeddingCache(inner, cache).embed(["hello"])).toEqual([[1, 2, 3]]);
    expect(inner.embed).toHaveBeenCalledTimes(1);
  });

  it("deduplicates within a single call", async () => {
    // Forty teams sharing one steering document would otherwise pay for it forty times per batch.
    const inner = { id: "test#dedupe", embed: vi.fn(async (texts: string[]) => texts.map(() => [1])) };
    const cached = withEmbeddingCache(inner, new EmbeddingCache(path.join(dir, "dedupe")));

    expect(await cached.embed(["same", "same", "other"])).toEqual([[1], [1], [1]]);
    expect(inner.embed.mock.calls[0]![0]).toEqual(["same", "other"]);
  });

  it("keys by provider id, so switching models does not serve vectors from another space", async () => {
    const a = { id: "model-a", embed: vi.fn(async (texts: string[]) => texts.map(() => [1])) };
    const b = { id: "model-b", embed: vi.fn(async (texts: string[]) => texts.map(() => [2])) };
    const cache = new EmbeddingCache(path.join(dir, "keyed"));

    await withEmbeddingCache(a, cache).embed(["text"]);
    expect(await withEmbeddingCache(b, cache).embed(["text"])).toEqual([[2]]);
    expect(b.embed).toHaveBeenCalledTimes(1);
  });

  it("treats a corrupt entry as a miss rather than a failure", async () => {
    const inner = { id: "test#corrupt", embed: vi.fn(async (texts: string[]) => texts.map(() => [9])) };
    const root = path.join(dir, "corrupt");
    const cache = new EmbeddingCache(root);
    await cache.write("test#corrupt", "text", [9]);

    for (const shard of fs.readdirSync(root)) {
      for (const file of fs.readdirSync(path.join(root, shard))) {
        fs.writeFileSync(path.join(root, shard, file), "{not json", "utf-8");
      }
    }
    expect(await withEmbeddingCache(inner, cache).embed(["text"])).toEqual([[9]]);
    expect(inner.embed).toHaveBeenCalledTimes(1);
  });
});
