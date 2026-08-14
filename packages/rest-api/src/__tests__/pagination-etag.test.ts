import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";
import { ifNoneMatchSatisfied } from "../plugins/etag";
import { MAX_LIMIT } from "../pagination";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let app: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  app = await buildServer(store);
});

/** Parses an RFC 8288 `Link` header into `{ rel: url }`. */
function links(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(", ").map((entry) => {
      const [, url, rel] = /^<([^>]+)>; rel="([^"]+)"$/.exec(entry)!;
      return [rel!, url!];
    }),
  );
}

describe("pagination", () => {
  it("returns the whole collection, and a total, when nothing is asked for", async () => {
    const res = await app.inject({ method: "GET", url: "/teams" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(4);
    expect(res.headers["x-total-count"]).toBe("4");
    // No Link header on an unpaginated response: there are no other pages to point at, and a
    // `next` on a complete collection would send a client round a loop it can never leave.
    expect(res.headers.link).toBeUndefined();
  });

  it("slices with limit and offset, and counts the whole collection either way", async () => {
    const first = await app.inject({ method: "GET", url: "/teams?limit=2" });
    const second = await app.inject({ method: "GET", url: "/teams?limit=2&offset=2" });

    expect(first.json()).toHaveLength(2);
    expect(second.json()).toHaveLength(2);
    expect(first.headers["x-total-count"]).toBe("4");
    // Different pages, not the same page twice — the assertion that actually catches an offset
    // that is applied to the wrong array or not at all.
    const ids = (res: typeof first): string[] => res.json<Array<{ id: string }>>().map((team) => team.id);
    expect(ids(first)).not.toEqual(ids(second));
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(4);
  });

  it("links first, next, prev and last, as paths rather than absolute URLs", async () => {
    const middle = await app.inject({ method: "GET", url: "/teams?limit=1&offset=1" });
    const rels = links(middle.headers.link as string);

    expect(rels).toEqual({
      first: "/teams?limit=1&offset=0",
      next: "/teams?limit=1&offset=2",
      prev: "/teams?limit=1&offset=0",
      // The offset of the last *page*, not of the last item, so a client following it lands on a
      // page boundary rather than mid-page.
      last: "/teams?limit=1&offset=3",
    });
    // Paths, because an absolute URL would bake in whatever Host header arrived — behind a proxy
    // routinely an internal name the client cannot reach.
    for (const url of Object.values(rels)) expect(url.startsWith("/")).toBe(true);
  });

  it("omits next on the last page and prev on the first", async () => {
    expect(
      links((await app.inject({ method: "GET", url: "/teams?limit=2" })).headers.link as string),
    ).not.toHaveProperty("prev");
    expect(
      links((await app.inject({ method: "GET", url: "/teams?limit=2&offset=2" })).headers.link as string),
    ).not.toHaveProperty("next");
  });

  it("preserves the other query parameters in its links", async () => {
    const res = await app.inject({ method: "GET", url: "/teams?type=stream-aligned&limit=1" });
    expect(links(res.headers.link as string).next).toBe("/teams?type=stream-aligned&limit=1&offset=1");
  });

  it("answers an offset past the end with an empty page, not an error", async () => {
    const res = await app.inject({ method: "GET", url: "/teams?offset=999&limit=10" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(res.headers["x-total-count"]).toBe("4");
  });

  it("rejects a limit above the ceiling, and a negative offset", async () => {
    expect((await app.inject({ method: "GET", url: `/teams?limit=${MAX_LIMIT + 1}` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/teams?offset=-1" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/teams?limit=0" })).statusCode).toBe(400);
  });

  it.each(["/services", "/search?q=checkout", "/agents", "/teams/stream-checkout/agents"])(
    "paginates %s",
    async (url) => {
      const separator = url.includes("?") ? "&" : "?";
      const res = await app.inject({ method: "GET", url: `${url}${separator}limit=1` });
      expect(res.statusCode).toBe(200);
      expect(res.json().length).toBeLessThanOrEqual(1);
      expect(res.headers["x-total-count"]).toBeDefined();
    },
  );
});

describe("ETag", () => {
  it("sends a content-derived ETag on a GET, and 304s a request that already has it", async () => {
    const first = await app.inject({ method: "GET", url: "/teams" });
    const etag = first.headers.etag as string;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

    const second = await app.inject({ method: "GET", url: "/teams", headers: { "if-none-match": etag } });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    // Recomputed from the empty payload rather than left behind promising bytes that never arrive.
    expect(second.headers["content-length"]).toBe("0");
  });

  it("gives different representations different ETags", async () => {
    const teams = await app.inject({ method: "GET", url: "/teams" });
    const graph = await app.inject({ method: "GET", url: "/graph" });
    expect(teams.headers.etag).not.toBe(graph.headers.etag);
  });

  it("gives the same representation the same ETag across a reload", async () => {
    // The reason to hash the body rather than the graph's resolvedAt: a reload that changed
    // nothing an endpoint returns must not invalidate every client's cache. resolvedAt changes on
    // every reload, which would make the validator worthless exactly when reloads are frequent.
    const before = await app.inject({ method: "GET", url: "/teams" });
    await app.orgGraphStore.load();
    const after = await app.inject({ method: "GET", url: "/teams" });
    expect(after.headers.etag).toBe(before.headers.etag);
  });

  it("does not 304 a stale validator", async () => {
    const res = await app.inject({ method: "GET", url: "/teams", headers: { "if-none-match": '"not-the-etag"' } });
    expect(res.statusCode).toBe(200);
  });

  it("leaves error responses unvalidated", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.headers.etag).toBeUndefined();
  });
});

describe("ifNoneMatchSatisfied", () => {
  it("matches a single tag, a list, and the wildcard", () => {
    expect(ifNoneMatchSatisfied('"abc"', '"abc"')).toBe(true);
    expect(ifNoneMatchSatisfied('"xyz", "abc"', '"abc"')).toBe(true);
    expect(ifNoneMatchSatisfied("*", '"abc"')).toBe(true);
    // A weak validator over the same representation is still a match for this purpose: the client
    // is telling us which bytes it holds, and W/ only ever weakens what equality means.
    expect(ifNoneMatchSatisfied('W/"abc"', '"abc"')).toBe(true);
  });

  it("does not match an absent, empty, or different tag", () => {
    expect(ifNoneMatchSatisfied(undefined, '"abc"')).toBe(false);
    expect(ifNoneMatchSatisfied("", '"abc"')).toBe(false);
    expect(ifNoneMatchSatisfied('"xyz"', '"abc"')).toBe(false);
  });
});
