import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { analyzeProposalScenario } from "../propose/scenario";
import type { OrgGraph } from "../model/org-graph";

const SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [SEED] });
});

describe("analyzeProposalScenario", () => {
  it("simulates a proposal without mutating the served graph", () => {
    const original = graph.teams.get("stream-checkout")!.doc.info.focus;
    const scenario = analyzeProposalScenario(graph, "stream-checkout", { info: { focus: "Own every checkout flow" } });

    expect(scenario.simulatedGraph.teams.get("stream-checkout")!.doc.info.focus).toBe("Own every checkout flow");
    expect(graph.teams.get("stream-checkout")!.doc.info.focus).toBe(original);
  });

  it("reports before/after load and policy effects", () => {
    const scenario = analyzeProposalScenario(graph, "stream-checkout", {
      cognitiveLoad: { intrinsic: 10, extraneous: 10, germane: 10, supervision: 10 },
    });

    expect(scenario.diff.teamsChanged).toHaveLength(1);
    expect(scenario.diff.teamsChanged[0]!.cognitiveLoad?.after?.label).toBe("overloaded");
    expect(scenario.after.maxCognitiveLoad).toBeGreaterThanOrEqual(scenario.before.maxCognitiveLoad);
    expect(scenario.policies.added.every((finding) => finding.teamId === "stream-checkout")).toBe(true);
  });

  it("captures accountability gaps resolved by a supervision assessment", () => {
    const team = graph.teams.get("stream-checkout")!;
    const base: OrgGraph = {
      ...graph,
      teams: new Map(graph.teams).set("stream-checkout", {
        ...team,
        doc: {
          ...structuredClone(team.doc),
          agents: [
            {
              id: "reviewer",
              name: "Reviewer",
              provider: "internal",
              model: "review-v1",
              role: "Review changes",
              capabilities: [],
              permissions: [],
              tags: [],
              status: "active",
            },
          ],
          cognitiveLoad: { intrinsic: 6, extraneous: 3, germane: 5 },
        },
      }),
    };
    const scenario = analyzeProposalScenario(base, "stream-checkout", {
      cognitiveLoad: { intrinsic: 6, extraneous: 3, germane: 5, supervision: 4 },
    });

    expect(scenario.gaps.resolved.some((finding) => finding.kind === "unscored-supervision")).toBe(true);
  });

  it("rejects unknown teams and unsafe fields", () => {
    expect(() => analyzeProposalScenario(graph, "missing", { info: { focus: "x" } })).toThrow(/Unknown team/);
    expect(() => analyzeProposalScenario(graph, "stream-checkout", { dependencies: [] })).toThrow();
  });
});
