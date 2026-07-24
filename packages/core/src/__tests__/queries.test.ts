import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import {
  findServiceOwner,
  getDependencies,
  getInteractions,
  getTeam,
  listMembers,
  listRoles,
  listServices,
  listTeams,
  searchOrg,
} from "../model/queries";
import type { OrgGraph } from "../model/org-graph";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
});

describe("listTeams", () => {
  it("lists every team sorted by id", () => {
    expect(listTeams(graph).map((t) => t.id)).toEqual([
      "enabling-devex",
      "platform-payments",
      "stream-checkout",
      "stream-onboarding",
    ]);
  });

  it("filters by type", () => {
    expect(listTeams(graph, { type: "platform" }).map((t) => t.id)).toEqual(["platform-payments"]);
  });

  it("filters by a case-insensitive search on name/focus", () => {
    expect(listTeams(graph, { search: "checkout" }).map((t) => t.id)).toEqual(["stream-checkout"]);
  });
});

describe("getTeam", () => {
  it("returns the team for a known id", () => {
    expect(getTeam(graph, "stream-checkout")?.id).toBe("stream-checkout");
  });

  it("returns undefined for an unknown id", () => {
    expect(getTeam(graph, "does-not-exist")).toBeUndefined();
  });
});

describe("getInteractions", () => {
  it("defaults to both directions", () => {
    const both = getInteractions(graph, "platform-payments");
    expect(both.length).toBeGreaterThan(0);
    expect(both.every((e) => e.from === "platform-payments" || e.to === "platform-payments")).toBe(true);
  });

  it("filters to inbound-only", () => {
    const inbound = getInteractions(graph, "platform-payments", "in");
    expect(inbound.every((e) => e.to === "platform-payments")).toBe(true);
  });

  it("filters to outbound-only", () => {
    const outbound = getInteractions(graph, "stream-checkout", "out");
    expect(outbound.every((e) => e.from === "stream-checkout")).toBe(true);
  });
});

describe("getDependencies", () => {
  it("defaults to outbound only", () => {
    const out = getDependencies(graph, "stream-checkout");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ from: "stream-checkout", to: "stream-onboarding" });
  });

  it("returns inbound dependencies with direction=in", () => {
    const inbound = getDependencies(graph, "stream-onboarding", "in");
    expect(inbound.some((e) => e.from === "stream-checkout")).toBe(true);
  });
});

describe("listServices / findServiceOwner", () => {
  it("lists every service across the org, sorted by name", () => {
    const names = listServices(graph).map((s) => s.service.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("checkout-api");
  });

  it("filters by a case-insensitive substring", () => {
    const results = listServices(graph, "LEDGER");
    expect(results).toHaveLength(1);
    expect(results[0]?.service.name).toBe("ledger");
  });

  it("finds the exact-match owner of a service", () => {
    expect(findServiceOwner(graph, "checkout-api")?.teamId).toBe("stream-checkout");
  });

  it("is case-insensitive but requires an exact match, not a substring", () => {
    expect(findServiceOwner(graph, "CHECKOUT-API")?.teamId).toBe("stream-checkout");
    expect(findServiceOwner(graph, "checkout")).toBeUndefined();
  });

  it("returns undefined for an unknown service", () => {
    expect(findServiceOwner(graph, "does-not-exist")).toBeUndefined();
  });

  it("deterministically picks the alphabetically-first team when service names collide", () => {
    // Constructed directly (not via buildOrgGraph) so the Map's insertion order can be set up
    // deliberately: "team-b" is inserted first, to prove the alphabetical tie-break — not
    // insertion order — decides the winner.
    const makeTeam = (id: string) => ({
      id,
      sourceUri: `/${id}.yml`,
      doc: {
        teamApiVersion: "1.0.0" as const,
        id,
        info: { name: id, type: "stream-aligned" as const },
        channels: [],
        searchTerms: [],
        services: [{ name: "shared-svc" }],
        roles: [],
        members: [],
        meetings: [],
        interactions: [],
        dependencies: [],
        agents: [],
        memory: [],
        specifications: [],
        steeringDocuments: [],
        prompts: [],
        playbooks: [],
        policies: [],
        knowledgeBase: [],
        workflows: [],
        sessions: [],
      },
    });
    const collidingGraph: OrgGraph = {
      teams: new Map([
        ["team-b", makeTeam("team-b")],
        ["team-a", makeTeam("team-a")],
      ]),
      edges: [],
      roleEdges: [],
      unresolved: [],
      meta: { resolvedAt: "2026-01-01T00:00:00.000Z", sourceRoots: [] },
    };

    expect(findServiceOwner(collidingGraph, "shared-svc")?.teamId).toBe("team-a");
  });
});

describe("listRoles / listMembers", () => {
  it("lists roles sorted by id", () => {
    expect(listRoles(graph, "stream-checkout").map((r) => r.role.id)).toEqual([
      "backend-engineer",
      "frontend-engineer",
      "tech-lead",
    ]);
  });

  it("returns an empty array for an unknown team", () => {
    expect(listRoles(graph, "does-not-exist")).toEqual([]);
    expect(listMembers(graph, "does-not-exist")).toEqual([]);
  });

  it("lists members sorted by id", () => {
    const ids = listMembers(graph, "stream-checkout").map((m) => m.member.id);
    expect(ids).toEqual([...ids].sort());
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe("searchOrg", () => {
  it("finds matches across teams, services, roles, members, and search terms", () => {
    const results = searchOrg(graph, "checkout");
    const kinds = new Set(results.map((r) => r.kind));
    expect(kinds.has("team")).toBe(true);
    expect(kinds.has("service")).toBe(true);
    expect(kinds.has("searchTerm")).toBe(true);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchOrg(graph, "zzz-no-match-zzz")).toEqual([]);
  });
});
