import { describe, expect, it } from "vitest";
import { EvidenceLedger } from "../evidence/ledger";

const evidence = {
  id: "deploy-42",
  kind: "change",
  source: "github",
  observedAt: "2026-08-26T12:00:00.000Z",
  targetType: "service",
  targetId: "checkout-api",
  summary: "Deployment completed",
  confidence: 1,
  attributes: { sha: "abc123" },
} as const;

describe("EvidenceLedger", () => {
  it("ingests evidence idempotently", () => {
    const ledger = new EvidenceLedger();
    expect(ledger.ingest(evidence).created).toBe(true);
    expect(ledger.ingest(evidence).created).toBe(false);
    expect(ledger.list()).toHaveLength(1);
  });

  it("rejects conflicting reuse of an evidence id", () => {
    const ledger = new EvidenceLedger();
    ledger.ingest(evidence);
    expect(() => ledger.ingest({ ...evidence, summary: "Different claim" })).toThrow(/different content/);
  });

  it("filters and orders entries deterministically", () => {
    const ledger = new EvidenceLedger();
    ledger.ingest(evidence);
    ledger.ingest({
      ...evidence,
      id: "incident-9",
      kind: "incident",
      observedAt: "2026-08-27T12:00:00.000Z",
      summary: "Rollback required",
    });
    expect(ledger.list({ targetId: "checkout-api" }).map((entry) => entry.id)).toEqual(["incident-9", "deploy-42"]);
    expect(ledger.list({ kind: "incident" })).toHaveLength(1);
  });

  it("links findings and outcomes only to known evidence", () => {
    const ledger = new EvidenceLedger();
    ledger.ingest(evidence);
    const chain = ledger.link({
      id: "chain-1",
      finding: "checkout ownership is stale",
      targetId: "checkout-api",
      evidenceIds: ["deploy-42"],
      action: "transfer ownership",
      result: "open",
    });
    expect(chain.evidenceIds).toEqual(["deploy-42"]);
    expect(ledger.chains("checkout-api")).toHaveLength(1);
    expect(() => ledger.link({ ...chain, id: "bad", evidenceIds: ["missing"] })).toThrow(/Unknown evidence/);
  });
});
