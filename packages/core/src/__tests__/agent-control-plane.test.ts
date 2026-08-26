import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAgentFleet, routeAgentTask } from "../agents/control-plane";
import { buildOrgGraph } from "../resolve/graph-builder";
import type { OrgGraph } from "../model/org-graph";

const SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [SEED] });
});

describe("agent control plane", () => {
  it("builds a stable fleet inventory with governance health", () => {
    const fleet = buildAgentFleet(graph);
    expect(fleet.agents.map((entry) => entry.id)).toEqual([...fleet.agents.map((entry) => entry.id)].sort());
    expect(fleet.summary.total).toBeGreaterThan(0);
    expect(fleet.summary.active).toBeLessThanOrEqual(fleet.summary.total);
  });

  it("routes only to active, capable, permitted, human-owned agents", () => {
    const capable = buildAgentFleet(graph).agents.find(
      (entry) => entry.ownerResolved && entry.agent.capabilities.length > 0,
    );
    expect(capable).toBeDefined();
    const decision = routeAgentTask(graph, {
      capability: capable!.agent.capabilities[0]!,
      permissions: capable!.agent.permissions.slice(0, 1),
      preferredTeamId: capable!.teamId,
    });
    expect(decision.selected).toBeDefined();
    expect(decision.candidates[0]!.teamId).toBe(capable!.teamId);
  });

  it("explains why no agent can accept an impossible task", () => {
    const decision = routeAgentTask(graph, { capability: "teleport-production" });
    expect(decision.selected).toBeUndefined();
    expect(
      decision.rejected.every((entry) => entry.reasons.some((reason) => reason.includes("lacks capability"))),
    ).toBe(true);
  });

  it("returns the same decision for the same graph and request", () => {
    const request = { capability: "code-review", requireOwner: false };
    expect(routeAgentTask(graph, request)).toEqual(routeAgentTask(graph, request));
  });
});
