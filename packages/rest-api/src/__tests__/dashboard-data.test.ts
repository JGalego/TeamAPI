import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
const DASHBOARD = fs.readFileSync(path.resolve(__dirname, "../dashboard/index.html"), "utf-8");

let app: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  app = await buildServer(store);
});

const get = async (url: string) => {
  const res = await app.inject({ method: "GET", url });
  expect({ url, status: res.statusCode }).toMatchObject({ status: 200 });
  return res.json();
};

/**
 * The dashboard is static HTML that fetches this API, which means nothing type-checks the joins
 * between them: a route that renamed a field, or a section fetching a URL that does not exist,
 * fails silently in a browser as an empty box.
 *
 * These tests assert the *shapes* the dashboard reads, not the rendering. Every URL below is one
 * the page actually requests, and every field asserted is one it actually reaches for.
 */
describe("dashboard data contract", () => {
  it("fetches only URLs this server serves", async () => {
    // Pulled out of the page itself rather than listed here, so a section added later is checked
    // by existing rather than by somebody remembering to add it.
    // Only the literal URLs: a template with `${teamId}` in it has no fixed form to request, and
    // those joins are covered by the team-panel tests instead.
    const urls = [...DASHBOARD.matchAll(/getJson\(\s*[`"]([^`"]+)[`"]/g)]
      .map((match) => match[1]!)
      .filter((url) => !url.includes("${"));
    expect(urls.length).toBeGreaterThan(4);
    for (const url of new Set(urls)) {
      const res = await app.inject({ method: "GET", url });
      expect({ url, status: res.statusCode }).toMatchObject({ status: 200 });
    }
  });

  it("/agents carries the owner, provider, status and team the roster displays", async () => {
    // `{ teamId, item }`, not the resource itself — the shape the dashboard has to unwrap, and
    // the one it silently rendered as blanks before this test existed.
    const entries = (await get("/agents")) as Array<{ teamId: string; item: Record<string, unknown> }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const agent = entry.item;
      expect(typeof agent.name).toBe("string");
      expect(typeof entry.teamId).toBe("string");
      expect(typeof agent.provider).toBe("string");
      // `status` defaults rather than being absent, and `ownerId` is the field the roster marks in
      // red when it is missing — the whole point of the section.
      expect(["active", "inactive", "deprecated"]).toContain(agent.status);
      expect(agent.ownerId === undefined || typeof agent.ownerId === "string").toBe(true);
    }
  });

  it("/sessions carries what the session list shows", async () => {
    const entries = (await get("/sessions")) as Array<{ teamId: string; item: Record<string, unknown> }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const { teamId, item } of entries) {
      expect(typeof teamId).toBe("string");
      expect(typeof item.objective).toBe("string");
      expect(typeof item.assistant).toBe("string");
    }
  });

  it("/context-map carries relationships and conflicts separately", async () => {
    // The diagram tab can show the relationships; only this shape can show a disagreement between
    // two teams about one relationship, which is the most useful thing the derivation produces.
    const map = (await get("/context-map")) as {
      relationships: Array<Record<string, unknown>>;
      conflicts: Array<Record<string, unknown>>;
    };
    expect(Array.isArray(map.relationships)).toBe(true);
    expect(Array.isArray(map.conflicts)).toBe(true);
    for (const relationship of map.relationships) {
      expect(typeof relationship.from).toBe("string");
      expect(typeof relationship.to).toBe("string");
      expect(["explicit", "heuristic"]).toContain(relationship.source);
    }
  });

  it("/knowledge-graph traverses from a node the picker offers", async () => {
    const graph = (await get("/knowledge-graph")) as {
      nodes: Array<{ id: string; kind: string; label: string }>;
      edges: unknown[];
    };
    expect(graph.nodes.length).toBeGreaterThan(0);

    const start = graph.nodes[0]!;
    expect(typeof start.label).toBe("string");
    expect(typeof start.kind).toBe("string");

    // The page builds this URL with `depth`; a rename to `maxDepth` would silently traverse to the
    // default instead of what the control says.
    const scoped = (await get(`/knowledge-graph/${encodeURIComponent(start.id)}/traverse?depth=1`)) as {
      nodes: unknown[];
      edges: Array<Record<string, unknown>>;
    };
    expect(scoped.nodes.length).toBeGreaterThan(0);
    for (const edge of scoped.edges) {
      expect(typeof edge.from).toBe("string");
      expect(typeof edge.to).toBe("string");
      expect(typeof edge.relation).toBe("string");
    }
  });

  it("respects the depth it is given", async () => {
    const graph = (await get("/knowledge-graph")) as { nodes: Array<{ id: string }> };
    const start = graph.nodes[0]!.id;
    const shallow = (await get(`/knowledge-graph/${encodeURIComponent(start)}/traverse?depth=1`)) as { nodes: [] };
    const deep = (await get(`/knowledge-graph/${encodeURIComponent(start)}/traverse?depth=3`)) as { nodes: [] };
    expect(deep.nodes.length).toBeGreaterThanOrEqual(shallow.nodes.length);
  });
});
