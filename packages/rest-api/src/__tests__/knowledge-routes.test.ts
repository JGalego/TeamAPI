import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let app: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  app = await buildServer(store);
});

describe("AI-native resource routes", () => {
  it("GET /agents lists agents across the org", async () => {
    const res = await app.inject({ method: "GET", url: "/agents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.some((e: { item: { id: string } }) => e.item.id === "architecture-reviewer")).toBe(true);
  });

  it("GET /teams/:id/agents lists one team's full agent fleet", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/platform-payments/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((a: { id: string }) => a.id)).toEqual([
      "architecture-reviewer",
      "compliance-auditor",
      "docs-writer",
      "security-scanner",
      "test-generator",
    ]);
  });

  it("GET /teams/:id/agents is empty for a team deliberately kept agent-free", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-onboarding/agents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /teams/:id/policies documents why that team stays agent-free", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-onboarding/policies" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { id: string }) => p.id)).toContain("no-agents-on-applicant-pii");
  });

  it("GET /teams/:id/agents 404s for an unknown team", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/does-not-exist/agents" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /teams/:id/agents/:resourceId gets one agent", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/platform-payments/agents/architecture-reviewer" });
    expect(res.statusCode).toBe(200);
    expect(res.json().provider).toBe("OpenAI");
  });

  it("GET /teams/:id/agents/:resourceId 404s for an unknown agent id", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/platform-payments/agents/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /teams/:id/specifications lists a team's specifications", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-checkout/specifications" });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((s: { id: string }) => s.id)).toEqual(["oauth-login-support"]);
  });

  it("GET /teams/:id/steering returns only this team's own documents by default", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-checkout/steering" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /teams/:id/steering?effective=true includes inherited organization-scoped documents", async () => {
    const res = await app.inject({ method: "GET", url: "/teams/stream-checkout/steering?effective=true" });
    expect(res.statusCode).toBe(200);
    const ids = res.json().map((d: { id: string }) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["security-guidelines", "api-conventions"]));
  });

  it("POST /teams/:id/prompts/:promptId/render fills variables", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/teams/platform-payments/prompts/code-review/render",
      payload: { variables: { repository: "checkout-api" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rendered).toContain("checkout-api");
  });

  it("POST /teams/:id/prompts/:promptId/render 400s when a required variable is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/teams/platform-payments/prompts/code-review/render", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("GET /knowledge-base, /playbooks, /policies, /workflows, /memory, /sessions all 200", async () => {
    for (const path of ["/knowledge-base", "/playbooks", "/policies", "/workflows", "/memory", "/sessions"]) {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode, path).toBe(200);
    }
  });
});

describe("POST /context", () => {
  it("assembles a context bundle for a goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/context",
      payload: { goal: "Implement OAuth login", teamId: "stream-checkout" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.specifications.some((s: { item: { id: string } }) => s.item.id === "oauth-login-support")).toBe(true);
    expect(body.relatedTeams.some((t: { id: string }) => t.id === "platform-payments")).toBe(true);
  });

  it("400s when goal is missing", async () => {
    const res = await app.inject({ method: "POST", url: "/context", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("404s for an unknown teamId", async () => {
    const res = await app.inject({ method: "POST", url: "/context", payload: { goal: "OAuth", teamId: "does-not-exist" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /knowledge-graph", () => {
  it("returns nodes and edges", async () => {
    const res = await app.inject({ method: "GET", url: "/knowledge-graph" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nodes.some((n: { id: string }) => n.id === "team:stream-checkout")).toBe(true);
    expect(body.edges.length).toBeGreaterThan(0);
  });

  it("GET /knowledge-graph/:nodeId/traverse returns a subgraph", async () => {
    const res = await app.inject({ method: "GET", url: "/knowledge-graph/team:stream-checkout/traverse?depth=1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().nodes.some((n: { id: string }) => n.id === "team:stream-checkout")).toBe(true);
  });

  it("GET /knowledge-graph/:nodeId/traverse 404s for an unknown node", async () => {
    const res = await app.inject({ method: "GET", url: "/knowledge-graph/does-not-exist/traverse" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /search includes AI-native resource kinds", () => {
  it("finds an agent by name", async () => {
    const res = await app.inject({ method: "GET", url: "/search?q=Architecture Reviewer" });
    expect(res.statusCode).toBe(200);
    expect(res.json().some((r: { kind: string }) => r.kind === "agent")).toBe(true);
  });
});
