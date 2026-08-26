import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EvidenceLedger } from "../evidence/ledger";
import { buildRecommendationDiagram } from "../diagrams/recommendations";
import { recommendOrgChanges } from "../recommendations/engine";
import { buildOrgGraph } from "../resolve/graph-builder";
import type { OrgGraph } from "../model/org-graph";

const SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [SEED] });
});

function ledger(): EvidenceLedger {
  const result = new EvidenceLedger();
  result.ingest({
    id: "incident-checkout-1",
    kind: "incident",
    source: "pagerduty",
    observedAt: "2026-08-26T12:00:00.000Z",
    targetType: "team",
    targetId: "stream-checkout",
    summary: "Checkout latency incident",
    confidence: 0.95,
    attributes: {},
  });
  return result;
}

describe("evidence-backed recommendations", () => {
  it("derives stable, explainable recommendations from findings and evidence", () => {
    const first = recommendOrgChanges(graph, ledger());
    const second = recommendOrgChanges(graph, ledger());
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((entry) => entry.sources.length > 0)).toBe(true);
    expect(new Set(first.map((entry) => entry.id)).size).toBe(first.length);
  });

  it("cites incident evidence in reliability recommendations", () => {
    const recommendation = recommendOrgChanges(graph, ledger()).find((entry) => entry.category === "reliability");
    expect(recommendation).toMatchObject({
      teamIds: ["stream-checkout"],
      evidenceIds: ["incident-checkout-1"],
    });
  });

  it("ignores evidence below the requested confidence threshold", () => {
    const recommendations = recommendOrgChanges(graph, ledger(), { minimumConfidence: 0.99 });
    expect(recommendations.some((entry) => entry.category === "reliability")).toBe(false);
  });

  it("builds a recommendation pressure diagram", () => {
    const recommendations = recommendOrgChanges(graph, ledger());
    const diagram = buildRecommendationDiagram(recommendations);
    expect(diagram.nodes.some((node) => node.id === "team:stream-checkout")).toBe(true);
    expect(diagram.edges.length).toBeGreaterThan(0);
  });
});
