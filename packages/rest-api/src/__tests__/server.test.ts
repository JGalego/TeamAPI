import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
const PACKAGE_VERSION = (
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8")) as { version: string }
).version;

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

  it("GET /teams/:id/interactions 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/does-not-exist/interactions" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /teams/:id/interactions?direction=in returns only inbound edges", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/platform-payments/interactions?direction=in" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((e: { to: string }) => e.to === "platform-payments")).toBe(true);
  });

  it("GET /teams/:id/dependencies defaults to outbound", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-checkout/dependencies" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ from: "stream-checkout", to: "stream-onboarding", type: "Slowing" });
  });

  it("GET /teams/:id/dependencies?direction=in returns who depends on this team", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-onboarding/dependencies?direction=in" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.some((e: { from: string }) => e.from === "stream-checkout")).toBe(true);
  });

  it("GET /teams/:id/dependencies 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/does-not-exist/dependencies" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /teams/:id/roles returns roles and members", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-checkout/roles" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.roles.map((r: { id: string }) => r.id).sort()).toEqual([
      "backend-engineer",
      "frontend-engineer",
      "tech-lead",
    ]);
    expect(body.members.length).toBeGreaterThan(0);
  });

  it("GET /teams/:id/roles 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/does-not-exist/roles" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /services lists every service across the org", async () => {
    const res = await app.inject({ method: "GET", url: "/services" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.some((s: { service: { name: string } }) => s.service.name === "checkout-api")).toBe(true);
  });

  it("GET /services?search= filters by substring", async () => {
    const res = await app.inject({ method: "GET", url: "/services?search=checkout" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.every((s: { service: { name: string } }) => s.service.name.includes("checkout"))).toBe(true);
  });

  it("GET /services/:name finds the owning team", async () => {
    const res = await app.inject({ method: "GET", url: "/services/payments-api" });
    expect(res.statusCode).toBe(200);
    expect(res.json().teamId).toBe("platform-payments");
  });

  it("GET /services/:name 404s for an unknown service", async () => {
    const res = await app.inject({ method: "GET", url: "/services/does-not-exist" });
    expect(res.statusCode).toBe(404);
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

  it("GET /search?q= (present but empty) is also a 400 with the same error body", async () => {
    const missing = await app.inject({ method: "GET", url: "/search" });
    const empty = await app.inject({ method: "GET", url: "/search?q=" });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual(missing.json());
  });

  it("GET /graph returns the full resolved graph, including role-level edges", async () => {
    const res = await app.inject({ method: "GET", url: "/graph" });
    const body = res.json();
    expect(body.teams).toHaveLength(4);
    expect(body.edges.length).toBeGreaterThan(0);
    expect(body.roleEdges.length).toBeGreaterThan(0);
    expect(body.roleEdges.some((e: { kind: string }) => e.kind === "reports-to")).toBe(true);
    expect(body.roleEdges.some((e: { kind: string }) => e.kind === "aligns-with")).toBe(true);
  });

  it("GET /diagrams/topology?format=mermaid returns mermaid text", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/topology?format=mermaid" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("flowchart LR");
  });

  it("GET /diagrams/topology?format=dot returns DOT text", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/topology?format=dot" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("digraph");
  });

  it("GET /diagrams/topology?teamId= scopes to one team's neighborhood", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/topology?teamId=stream-checkout" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("stream_checkout");
  });

  it("GET /diagrams/topology?teamId= 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/topology?teamId=does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /diagrams/hierarchy/:teamId renders one team's role hierarchy", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/hierarchy/stream-checkout" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("flowchart TD");
  });

  it("GET /diagrams/hierarchy/:teamId 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/hierarchy/does-not-exist" });
    expect(res.statusCode).toBe(404);
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

  it("GET /context-map?format=mermaid renders a diagram", async () => {
    const res = await app.inject({ method: "GET", url: "/context-map?format=mermaid" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("flowchart");
  });

  it("GET /context-map?format=dot renders a diagram", async () => {
    const res = await app.inject({ method: "GET", url: "/context-map?format=dot" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("digraph");
  });

  it("GET /context-map?teamId= 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/context-map?teamId=does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /cognitive-load returns an org-wide report sorted by total", async () => {
    const res = await app.inject({ method: "GET", url: "/cognitive-load" });
    const body = res.json();
    expect(body[0].teamId).toBe("stream-checkout"); // highest total in the fixture
  });

  it("GET /cognitive-load/:teamId returns one team's score", async () => {
    const res = await app.inject({ method: "GET", url: "/cognitive-load/stream-checkout" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ teamId: "stream-checkout", label: "overloaded" });
  });

  it("GET /cognitive-load/:teamId 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/cognitive-load/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /cognitive-load/:teamId 404s for a team with no cognitiveLoad assessment", async () => {
    const res = await app.inject({ method: "GET", url: "/cognitive-load/enabling-devex" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /teams?type= rejects an invalid team type with a 400", async () => {
    const res = await app.inject({ method: "GET", url: "/teams?type=bogus" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /diagrams/topology?format= rejects an invalid format with a 400", async () => {
    const res = await app.inject({ method: "GET", url: "/diagrams/topology?format=xml" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /docs/json serves a valid OpenAPI document", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.openapi).toBe("3.0.3");
    expect(body.info.version).toBe(PACKAGE_VERSION); // must track the package's real version, not a stale literal
  });

  it("GET /docs serves the Swagger UI", async () => {
    const res = await app.inject({ method: "GET", url: "/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET / redirects to /docs", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/docs");
  });
});
