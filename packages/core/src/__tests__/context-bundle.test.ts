import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { deriveContextBundle } from "../context-bundle/derive";
import type { OrgGraph } from "../model/org-graph";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
});

describe("deriveContextBundle", () => {
  it("surfaces the OAuth specification, steering guidance, ADR, and prompt for an OAuth goal", () => {
    const bundle = deriveContextBundle(graph, { goal: "Implement OAuth login", teamId: "stream-checkout" });

    expect(bundle.specifications.map((s) => s.item.id)).toContain("oauth-login-support");
    expect(bundle.steeringDocuments.map((s) => s.item.id)).toContain("security-guidelines");
    expect(bundle.knowledgeBase.map((k) => k.item.id)).toContain("adr-oauth-for-login");
    expect(bundle.prompts.map((p) => p.item.id)).toContain("code-review");
  });

  it("includes matchedTerms explaining why each result was ranked", () => {
    const bundle = deriveContextBundle(graph, { goal: "Implement OAuth login", teamId: "stream-checkout" });
    const spec = bundle.specifications.find((s) => s.item.id === "oauth-login-support");
    expect(spec?.matchedTerms.length).toBeGreaterThan(0);
  });

  it("boosts the scoped team's own resources over equally-relevant org-wide ones", () => {
    const scoped = deriveContextBundle(graph, { goal: "OAuth", teamId: "stream-checkout" });
    const spec = scoped.specifications.find((s) => s.item.id === "oauth-login-support");
    expect(spec?.teamId).toBe("stream-checkout");
  });

  it("resolves effective (inherited) steering documents when a team is scoped", () => {
    const bundle = deriveContextBundle(graph, { goal: "API conventions", teamId: "stream-checkout" });
    expect(bundle.steeringDocuments.map((s) => s.item.id)).toContain("api-conventions");
  });

  it("includes related teams via platform/interaction/dependency edges when scoped", () => {
    const bundle = deriveContextBundle(graph, { goal: "OAuth", teamId: "stream-checkout" });
    expect(bundle.relatedTeams.map((t) => t.id)).toContain("platform-payments");
  });

  it("includes the scoped team's own members and services", () => {
    const bundle = deriveContextBundle(graph, { goal: "OAuth", teamId: "stream-checkout" });
    expect(bundle.members.length).toBeGreaterThan(0);
    expect(bundle.services.some((s) => s.service.name === "checkout-api")).toBe(true);
  });

  it("returns an org-wide bundle (no team scoping) when teamId is omitted", () => {
    const bundle = deriveContextBundle(graph, { goal: "OAuth" });
    expect(bundle.teamId).toBeUndefined();
    expect(bundle.team).toBeUndefined();
    expect(bundle.members).toEqual([]);
    expect(bundle.specifications.length).toBeGreaterThan(0);
  });

  it("returns nothing for a goal that matches no resource text", () => {
    const bundle = deriveContextBundle(graph, { goal: "zzz-no-match-zzz-completely-unrelated" });
    expect(bundle.specifications).toEqual([]);
    expect(bundle.steeringDocuments).toEqual([]);
    expect(bundle.knowledgeBase).toEqual([]);
  });

  it("respects the limit option", () => {
    const bundle = deriveContextBundle(graph, { goal: "oauth security api", limit: 1 });
    expect(bundle.steeringDocuments.length).toBeLessThanOrEqual(1);
  });
});
