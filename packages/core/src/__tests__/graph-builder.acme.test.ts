import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

describe("buildOrgGraph — examples/acme-org", () => {
  it("resolves all four teams starting from a single seed", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });

    expect(graph.unresolved).toEqual([]);
    expect([...graph.teams.keys()].sort()).toEqual([
      "enabling-devex",
      "platform-payments",
      "stream-checkout",
      "stream-onboarding",
    ]);
  });

  it("produces the expected edge kinds and counts", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });

    const byKind = (kind: string) => graph.edges.filter((e) => e.kind === kind);
    expect(byKind("platform")).toHaveLength(1);
    expect(byKind("interaction")).toHaveLength(3); // checkout->payments, checkout->onboarding, onboarding->devex
    expect(byKind("dependency")).toHaveLength(2); // checkout->onboarding, onboarding->payments
  });

  it("carries the explicit contextMappingPattern through to the edge", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const toPayments = graph.edges.find(
      (e) => e.kind === "interaction" && e.from === "stream-checkout" && e.to === "platform-payments",
    );
    expect(toPayments).toMatchObject({ mode: "x-as-a-service", contextMappingPattern: "CustomerSupplier" });
  });
});
