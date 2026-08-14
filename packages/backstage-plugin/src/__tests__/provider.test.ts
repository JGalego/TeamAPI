import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCATION_ANNOTATION, ORIGIN_ANNOTATION, TeamApiEntityProvider } from "../provider";
import type { CatalogEntity, EntityProviderConnection } from "../provider";

const ENTITIES: CatalogEntity[] = [
  { apiVersion: "backstage.io/v1alpha1", kind: "Group", metadata: { name: "stream-checkout" }, spec: { type: "team" } },
  { apiVersion: "backstage.io/v1alpha1", kind: "User", metadata: { name: "diego-alves" }, spec: { memberOf: [] } },
];

/** Records what the provider applied, which is the whole observable surface of this class. */
function connection(): EntityProviderConnection & { mutations: unknown[] } {
  const mutations: unknown[] = [];
  return {
    mutations,
    applyMutation: async (mutation) => {
      mutations.push(mutation);
    },
  };
}

function stubFetch(response: { status?: number; body?: unknown }): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    const status = response.status ?? 200;
    if (status !== 200) return new Response("nope", { status, statusText: "Error" });
    return new Response(JSON.stringify(response.body ?? ENTITIES), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("TeamApiEntityProvider", () => {
  it("names itself distinctly, so two orgs can be ingested side by side", () => {
    expect(new TeamApiEntityProvider({ baseUrl: "http://x" }).getProviderName()).toBe(
      "teamapi-entity-provider:teamapi",
    );
    expect(new TeamApiEntityProvider({ baseUrl: "http://x", id: "eu" }).getProviderName()).toBe(
      "teamapi-entity-provider:eu",
    );
  });

  it("ingests the whole catalog on connect, rather than after one interval", async () => {
    const fetchMock = stubFetch({});
    const conn = connection();
    const provider = new TeamApiEntityProvider({ baseUrl: "http://teamapi:3000/", refreshIntervalMs: 60_000 });

    await provider.connect(conn);
    provider.disconnect();

    // Trailing slash tolerated; the path is appended exactly once.
    expect(fetchMock.mock.calls[0]![0]).toBe("http://teamapi:3000/backstage/catalog");
    expect(conn.mutations).toHaveLength(1);
  });

  it("applies a full mutation, which is what lets a deleted team leave the catalog", async () => {
    // An incremental mutation would leave a team that was removed from the org graph in the
    // catalog forever, which is the failure the generated-file approach already had.
    stubFetch({});
    const conn = connection();
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x" });
    await provider.connect(conn);
    provider.disconnect();

    const mutation = conn.mutations[0] as { type: string; entities: Array<{ locationKey: string }> };
    expect(mutation.type).toBe("full");
    expect(mutation.entities).toHaveLength(2);
    expect(mutation.entities[0]!.locationKey).toBe("teamapi-entity-provider:teamapi");
  });

  it("attributes every entity to one stable location", async () => {
    stubFetch({});
    const conn = connection();
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x" });
    await provider.connect(conn);
    provider.disconnect();

    const mutation = conn.mutations[0] as { entities: Array<{ entity: CatalogEntity }> };
    for (const { entity } of mutation.entities) {
      expect(entity.metadata.annotations?.[LOCATION_ANNOTATION]).toBe("url:http://x/backstage/catalog");
      expect(entity.metadata.annotations?.[ORIGIN_ANNOTATION]).toBe("url:http://x/backstage/catalog");
    }
  });

  it("does not overwrite an annotation the server already set", async () => {
    stubFetch({
      body: [
        {
          apiVersion: "v1",
          kind: "Group",
          metadata: { name: "g", annotations: { [LOCATION_ANNOTATION]: "url:elsewhere" } },
        },
      ],
    });
    const conn = connection();
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x" });
    await provider.connect(conn);
    provider.disconnect();

    const mutation = conn.mutations[0] as { entities: Array<{ entity: CatalogEntity }> };
    expect(mutation.entities[0]!.entity.metadata.annotations?.[LOCATION_ANNOTATION]).toBe("url:elsewhere");
  });

  it("sends the bearer token when the server needs one", async () => {
    const fetchMock = stubFetch({});
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x", token: "secret" });
    await provider.connect(connection());
    provider.disconnect();

    const headers = (fetchMock.mock.calls[0]![1] as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe("Bearer secret");
  });

  it("leaves the catalog alone when a refresh fails", async () => {
    // A Team API server being briefly unreachable must not empty somebody's service catalog,
    // which is exactly what a `full` mutation of zero entities would do.
    stubFetch({});
    const conn = connection();
    const errors: Error[] = [];
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x", onError: (err) => errors.push(err) });
    await provider.connect(conn);

    stubFetch({ status: 503 });
    await provider.refresh();
    provider.disconnect();

    expect(conn.mutations).toHaveLength(1);
    expect(errors[0]!.message).toContain("503");
  });

  it("refuses a response that is not a list of entities", async () => {
    stubFetch({ body: { items: [] } });
    const errors: Error[] = [];
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x", onError: (err) => errors.push(err) });
    await provider.connect(connection());
    provider.disconnect();
    expect(errors[0]!.message).toContain("did not return an array");
  });

  it("refuses an entity with no kind or name", async () => {
    // Otherwise the catalog processor crashes several layers away from the server that produced it.
    stubFetch({ body: [{ apiVersion: "v1", kind: "Group", metadata: {} }] });
    const errors: Error[] = [];
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x", onError: (err) => errors.push(err) });
    await provider.connect(connection());
    provider.disconnect();
    expect(errors[0]!.message).toContain("no kind or name");
  });

  it("rethrows a failure when no handler was given, rather than logging or swallowing it", async () => {
    // A provider that swallowed its errors would leave a catalog silently frozen at whatever it
    // last managed to read, which looks exactly like a catalog that is up to date. Logging it
    // here would be writing to somebody else's structured log stream.
    stubFetch({ status: 500 });
    const provider = new TeamApiEntityProvider({ baseUrl: "http://x" });
    await expect(provider.connect(connection())).rejects.toThrow("500");
    provider.disconnect();
  });

  it("refuses to refresh before it is connected", async () => {
    await expect(new TeamApiEntityProvider({ baseUrl: "http://x" }).refresh()).rejects.toThrow("not connected");
  });

  it("stops polling on disconnect, and tolerates being disconnected twice", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = stubFetch({});
      const provider = new TeamApiEntityProvider({ baseUrl: "http://x", refreshIntervalMs: 1000 });
      await provider.connect(connection());

      await vi.advanceTimersByTimeAsync(2500);
      const during = fetchMock.mock.calls.length;
      expect(during).toBeGreaterThan(1);

      provider.disconnect();
      provider.disconnect();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock.mock.calls.length).toBe(during);
    } finally {
      vi.useRealTimers();
    }
  });
});
