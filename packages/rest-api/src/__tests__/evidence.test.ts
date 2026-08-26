import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EvidenceLedger, OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
let plain: FastifyInstance;
let app: FastifyInstance;

const entry = {
  id: "incident-42",
  kind: "incident",
  source: "pagerduty",
  observedAt: "2026-08-26T12:00:00.000Z",
  targetType: "service",
  targetId: "checkout-api",
  summary: "Checkout latency breached its SLO",
  confidence: 1,
  attributes: { severity: "high" },
};

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [SEED] });
  await store.load();
  plain = await buildServer(store);
  app = await buildServer(store, { evidence: new EvidenceLedger() });
});

describe("evidence routes", () => {
  it("are opt-in", async () => {
    expect((await plain.inject({ method: "GET", url: "/evidence" })).statusCode).toBe(404);
  });

  it("ingests idempotently and filters evidence", async () => {
    const created = await app.inject({ method: "POST", url: "/evidence", payload: entry });
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/evidence", payload: entry })).statusCode).toBe(200);

    const listed = await app.inject({ method: "GET", url: "/evidence?targetId=checkout-api&kind=incident" });
    expect(listed.json()).toHaveLength(1);
  });

  it("rejects conflicting evidence ids", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/evidence",
      payload: { ...entry, summary: "A different claim" },
    });
    expect(response.statusCode).toBe(409);
  });

  it("links evidence to a remediation outcome", async () => {
    const linked = await app.inject({
      method: "POST",
      url: "/evidence/chains",
      payload: {
        id: "chain-42",
        finding: "checkout latency is unsafe",
        targetId: "checkout-api",
        evidenceIds: ["incident-42"],
        action: "reduce load",
        result: "open",
      },
    });
    expect(linked.statusCode).toBe(201);
    const chains = await app.inject({ method: "GET", url: "/evidence/chains?targetId=checkout-api" });
    expect(chains.json()).toHaveLength(1);
  });
});
