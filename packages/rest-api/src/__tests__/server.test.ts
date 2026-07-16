import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@teamapi/core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let app: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  app = await buildServer(store);
});

describe("REST API", () => {
  it("GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("GET /teams lists all four teams", async () => {
    const res = await app.inject({ method: "GET", url: "/teams" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.map((t: { id: string }) => t.id).sort()).toEqual([
      "enabling-devex",
      "platform-payments",
      "stream-checkout",
      "stream-onboarding",
    ]);
  });

  it("GET /teams?type=platform filters by type", async () => {
    const res = await app.inject({ method: "GET", url: "/teams?type=platform" });
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("platform-payments");
  });

  it("GET /teams/:id returns full detail", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-checkout" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roles.length).toBeGreaterThan(0);
    expect(body.cognitiveLoad.label).toBe("overloaded");
  });

  it("GET /teams/:id 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /teams/:id/interactions", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-checkout/interactions" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("GET /services/:name finds the owning team", async () => {
    const res = await app.inject({ method: "GET", url: "/services/payments-api" });
    expect(res.statusCode).toBe(200);
    expect(res.json().teamId).toBe("platform-payments");
  });

  it("GET /search?q= finds cross-cutting matches", async () => {
    const res = await app.inject({ method: "GET", url: "/search?q=checkout" });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it("GET /search without q is a 400", async () => {
    const res = await app.inject({ method: "GET", url: "/search" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /graph returns the full resolved graph", async () => {
    const res = await app.inject({ method: "GET", url: "/graph" });
    const body = res.json();
    expect(body.teams).toHaveLength(4);
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it("GET /diagrams/topology?format=mermaid returns mermaid text", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/topology?format=mermaid" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("flowchart LR");
  });

  it("GET /diagrams/org-hierarchy?format=mermaid groups roles into one box per team", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/org-hierarchy?format=mermaid" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("subgraph");
    expect(res.body).toContain("aligns with");
  });

  it("GET /context-map?format=json returns relationships and conflicts", async () => {
    const res = await app.inject({ method: "GET", url: "/context-map" });
    const body = res.json();
    expect(body.relationships.length).toBeGreaterThan(0);
    expect(body.conflicts).toEqual([]);
  });

  it("GET /cognitive-load returns an org-wide report sorted by total", async () => {
    const res = await app.inject({ method: "GET", url: "/cognitive-load" });
    const body = res.json();
    expect(body[0].teamId).toBe("stream-checkout"); // highest total in the fixture
  });
});
