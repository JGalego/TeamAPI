import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { listTeamSummaries, toOrgGraphDto, toTeamDetailDto, toTeamSummaryDto } from "../serialize/team-dto";
import type { OrgGraph } from "../model/org-graph";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
});

describe("toTeamSummaryDto", () => {
  it("summarizes a team's id/name/type/focus", () => {
    const team = graph.teams.get("stream-checkout")!;
    expect(toTeamSummaryDto(team)).toEqual({
      id: "stream-checkout",
      name: "Stream Checkout",
      type: "stream-aligned",
      focus: "Shopping cart, checkout flow, and order placement",
    });
  });
});

describe("toTeamDetailDto", () => {
  it("includes the scored cognitive load, not just the raw assessment", () => {
    const team = graph.teams.get("stream-checkout")!;
    const dto = toTeamDetailDto(team);
    expect(dto.cognitiveLoad).toMatchObject({ intrinsic: 6, extraneous: 8, germane: 4, total: 18, label: "overloaded" });
  });

  it("omits cognitiveLoad for a team with no assessment", () => {
    const team = graph.teams.get("enabling-devex")!;
    expect(toTeamDetailDto(team).cognitiveLoad).toBeUndefined();
  });

  it("flattens searchTerms to plain strings and exposes the platform $ref", () => {
    const team = graph.teams.get("stream-checkout")!;
    const dto = toTeamDetailDto(team);
    expect(dto.searchTerms).toEqual(expect.arrayContaining(["checkout", "cart", "order"]));
    expect(dto.platformRef).toBe("../platform-payments/teamapi.yml");
  });
});

describe("listTeamSummaries", () => {
  it("lists every team, sorted by id", () => {
    expect(listTeamSummaries(graph).map((t) => t.id)).toEqual([
      "enabling-devex",
      "platform-payments",
      "stream-checkout",
      "stream-onboarding",
    ]);
  });
});

describe("toOrgGraphDto", () => {
  it("includes teams, team-level edges, role-level edges, unresolved, and meta", () => {
    const dto = toOrgGraphDto(graph);
    expect(dto.teams).toHaveLength(4);
    expect(dto.edges.length).toBeGreaterThan(0);
    expect(dto.roleEdges.length).toBeGreaterThan(0);
    expect(dto.unresolved).toEqual([]);
    expect(dto.meta.sourceRoots).toEqual([CHECKOUT_SEED]);
  });
});
