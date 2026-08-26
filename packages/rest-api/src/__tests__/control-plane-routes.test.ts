import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EvidenceLedger, OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
let plain: FastifyInstance;
let governed: FastifyInstance;

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [SEED] });
  await store.load();
  const ledger = new EvidenceLedger();
  ledger.ingest({
    id: "directory-checkout",
    kind: "audit-log",
    source: "okta",
    observedAt: "2026-08-26T12:00:00.000Z",
    targetType: "team",
    targetId: "stream-checkout",
    summary: "Observed checkout team membership",
    confidence: 1,
    attributes: {},
  });
  ledger.ingest({
    id: "incident-checkout",
    kind: "incident",
    source: "pagerduty",
    observedAt: "2026-08-26T13:00:00.000Z",
    targetType: "team",
    targetId: "stream-checkout",
    summary: "Checkout latency incident",
    confidence: 0.9,
    attributes: {},
  });
  plain = await buildServer(store);
  governed = await buildServer(store, {
    evidence: ledger,
    reconciliation: {
      ledger,
      policy: {
        autoApproveThrough: "low",
        requiredEvidence: ["audit-log"],
        blockOnPolicySeverity: ["blocking"],
      },
    },
  });
});

describe("agent control-plane routes", () => {
  it("lists the governed agent fleet", async () => {
    const response = await plain.inject({ method: "GET", url: "/agents/fleet" });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ summary: { total: number } }>().summary.total).toBeGreaterThan(0);
  });

  it("dry-runs capability-aware task routing", async () => {
    const response = await plain.inject({
      method: "POST",
      url: "/agents/route",
      payload: { capability: "teleport-production" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ selected?: unknown }>().selected).toBeUndefined();
  });
});

describe("live digital twin route", () => {
  it("returns a replayable declared-state scene", async () => {
    const response = await plain.inject({ method: "GET", url: "/digital-twin" });
    expect(response.statusCode).toBe(200);
    const scene = response.json<{ teams: unknown[]; actors: unknown[]; links: unknown[]; events: unknown[] }>();
    expect(scene.teams.length).toBeGreaterThan(0);
    expect(scene.actors.length).toBeGreaterThan(0);
    expect(scene.links.length).toBeGreaterThan(0);
    expect(scene.events.length).toBeGreaterThan(0);
  });
});

describe("recommendation route", () => {
  it("is opt-in with evidence and returns a Mermaid pressure map", async () => {
    expect((await plain.inject({ method: "GET", url: "/recommendations" })).statusCode).toBe(404);
    const response = await governed.inject({ method: "GET", url: "/recommendations?minimumConfidence=0.8" });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ recommendations: unknown[]; mermaid: string }>();
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.mermaid).toContain("flowchart LR");
  });
});

describe("reconciliation route", () => {
  const action = {
    id: "okta-sync",
    system: "okta",
    teamId: "stream-checkout",
    operation: "sync-members",
    targetId: "stream-checkout",
    risk: "low",
  };

  it("returns policy-gate decisions without executing actions", async () => {
    expect(
      (await plain.inject({ method: "POST", url: "/reconciliation/evaluate", payload: { actions: [] } })).statusCode,
    ).toBe(404);
    const response = await governed.inject({
      method: "POST",
      url: "/reconciliation/evaluate",
      payload: { actions: [action] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<Array<{ decision: string }>>()[0]!.decision).toMatch(/approved|blocked/);
  });

  it("reports invalid reconciliation targets", async () => {
    const response = await governed.inject({
      method: "POST",
      url: "/reconciliation/evaluate",
      payload: { actions: [{ ...action, teamId: "unknown" }] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toMatch(/unknown team/i);
  });
});
