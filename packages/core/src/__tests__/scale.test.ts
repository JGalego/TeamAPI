import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { HttpDocumentCache } from "../resolve/http-cache";
import { HttpLoader, LoaderRegistry, type LoadedDocument } from "../resolve/loaders";
import { planGaps } from "../gaps/plan";
import { orgWideCognitiveLoadReport } from "../cognitive-load/score";
import { generateSyntheticOrg, type SyntheticOrg } from "../scale/synthetic-org";

const TEAM_COUNT = 400;

let tmp: string;
let org: SyntheticOrg;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "teamapi-scale-"));
  org = generateSyntheticOrg(tmp, { teams: TEAM_COUNT });
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe(`a synthetic org of ~${TEAM_COUNT} teams`, () => {
  it("resolves every team from a single seed, through $refs alone", async () => {
    const graph = await buildOrgGraph({ seedUris: [org.streamFiles[0]!], allowPartial: true });
    expect(graph.unresolved).toEqual([]);
    expect(graph.teams.size).toBe(org.files.length);
  });

  it("produces an identical graph at every concurrency, including serial", async () => {
    // The reason to assert this rather than just "it's faster": loading a level concurrently means
    // completion order is nondeterministic, and every first-writer-wins decision in the resolver
    // (duplicate team ids, the order of unresolved reports) would silently start depending on
    // which fetch returned first. Processing is ordered separately from loading precisely so this
    // holds, and nothing else would notice if it stopped holding.
    const shape = async (concurrency: number): Promise<string> => {
      const graph = await buildOrgGraph({ seedUris: org.files, allowPartial: true, concurrency });
      return JSON.stringify({
        teams: [...graph.teams.keys()],
        edges: graph.edges,
        roleEdges: graph.roleEdges,
        unresolved: graph.unresolved,
      });
    };
    const serial = await shape(1);
    expect(await shape(8)).toBe(serial);
    expect(await shape(64)).toBe(serial);
  });

  it("keeps the graph-wide analyses working at this size", async () => {
    const graph = await buildOrgGraph({ seedUris: org.files, allowPartial: true });
    expect(orgWideCognitiveLoadReport(graph)).toHaveLength(graph.teams.size);
    // Every synthetic service publishes an event nothing subscribes to, so this is a real report
    // rather than an empty one — the O(services²)-shaped code paths are actually exercised.
    expect(planGaps(graph).findings.length).toBeGreaterThan(0);
  });
});

describe("resolution concurrency", () => {
  /** A loader that records how many loads overlap, so "runs in parallel" is measured rather than
   * assumed from a wall-clock number that a fast machine would make meaningless. */
  class CountingRegistry extends LoaderRegistry {
    inFlight = 0;
    peak = 0;

    override async load(uri: string): Promise<LoadedDocument> {
      this.inFlight++;
      this.peak = Math.max(this.peak, this.inFlight);
      try {
        // A macrotask turn, so overlapping loads actually get a chance to overlap. Without a real
        // yield every load would resolve before the next one started and the peak would be 1 no
        // matter what the resolver did.
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await super.load(uri);
      } finally {
        this.inFlight--;
      }
    }
  }

  it("loads a BFS level concurrently, up to the limit", async () => {
    const loaders = new CountingRegistry();
    await buildOrgGraph({ seedUris: org.files, allowPartial: true, loaders, concurrency: 6 });
    expect(loaders.peak).toBeGreaterThan(1);
    expect(loaders.peak).toBeLessThanOrEqual(6);
  });

  it("stays strictly serial at concurrency 1", async () => {
    const loaders = new CountingRegistry();
    await buildOrgGraph({ seedUris: org.files.slice(0, 20), allowPartial: true, loaders, concurrency: 1 });
    expect(loaders.peak).toBe(1);
  });

  it("reports every failure in a level, not just the first", async () => {
    const missing = [path.join(tmp, "gone-a", "teamapi.yml"), path.join(tmp, "gone-b", "teamapi.yml")];
    const graph = await buildOrgGraph({ seedUris: missing, allowPartial: true, concurrency: 8 });
    expect(graph.unresolved).toHaveLength(2);
  });
});

describe("HttpDocumentCache", () => {
  let cacheDir: string;

  beforeAll(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamapi-httpcache-"));
  });

  afterAll(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const DOC = 'teamApiVersion: "1.0.0"\nid: remote\ninfo:\n  name: Remote\n  type: platform\n';

  function stubFetch(responses: Array<{ status: number; body?: string; etag?: string }>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => {
      const next = responses.shift() ?? { status: 500 };
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        statusText: String(next.status),
        headers: new Headers(next.etag ? { etag: next.etag } : {}),
        text: async () => next.body ?? "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("serves a fresh entry without touching the network", async () => {
    const cache = new HttpDocumentCache({ dir: path.join(cacheDir, "fresh"), maxAgeMs: 60_000 });
    const fetchMock = stubFetch([{ status: 200, body: DOC, etag: '"v1"' }]);

    const first = await new HttpLoader({ cache }).load("https://example.com/a.yml");
    expect(first.raw).toMatchObject({ id: "remote" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A separate loader, so the in-memory cache cannot be what answers — this is the on-disk half.
    const second = await new HttpLoader({ cache }).load("https://example.com/a.yml");
    expect(second.raw).toMatchObject({ id: "remote" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("revalidates a stale entry and reuses the body on 304", async () => {
    const cache = new HttpDocumentCache({ dir: path.join(cacheDir, "stale"), maxAgeMs: 0 });
    const fetchMock = stubFetch([{ status: 200, body: DOC, etag: '"v1"' }, { status: 304 }]);

    await new HttpLoader({ cache }).load("https://example.com/b.yml");
    const second = await new HttpLoader({ cache }).load("https://example.com/b.yml");

    expect(second.raw).toMatchObject({ id: "remote" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ headers: { "If-None-Match": '"v1"' } });
  });

  it("ignores a cache entry written for a different URL", async () => {
    const dir = path.join(cacheDir, "mismatch");
    const cache = new HttpDocumentCache({ dir });
    await cache.write({ url: "https://example.com/c.yml", body: DOC, fetchedAt: Date.now() });
    expect(await cache.read("https://example.com/c.yml")).toMatchObject({ body: DOC });
    expect(await cache.read("https://example.com/other.yml")).toBeUndefined();
  });

  it("treats an unreadable cache as a miss rather than a failure", async () => {
    const cache = new HttpDocumentCache({ dir: path.join(cacheDir, "corrupt") });
    await cache.write({ url: "https://example.com/d.yml", body: DOC, fetchedAt: Date.now() });
    // Corrupt every entry in place. A cache is a speed-up; a build that fails because of one is a
    // worse outcome than a slow build.
    const dir = path.join(cacheDir, "corrupt");
    for (const name of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, name), "{not json", "utf-8");
    expect(await cache.read("https://example.com/d.yml")).toBeUndefined();
  });

  it("does not write anything when no cache is configured", async () => {
    const before = fs.existsSync(".teamapi-cache");
    stubFetch([{ status: 200, body: DOC }]);
    await new HttpLoader().load("https://example.com/e.yml");
    expect(fs.existsSync(".teamapi-cache")).toBe(before);
  });
});
