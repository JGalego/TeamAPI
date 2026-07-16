import { describe, expect, it } from "vitest";
import { deriveContextMap } from "../context-map/derive";
import type { GraphEdge, OrgGraph } from "../model/org-graph";

function graphWithEdges(edges: GraphEdge[]): OrgGraph {
  return { teams: new Map(), edges, unresolved: [], meta: { resolvedAt: "", sourceRoots: [] } };
}

describe("deriveContextMap", () => {
  it("uses the explicit pattern when a team sets one", () => {
    const graph = graphWithEdges([
      { kind: "interaction", from: "a", to: "b", mode: "collaboration", contextMappingPattern: "SharedKernel" },
    ]);
    const map = deriveContextMap(graph);
    expect(map.relationships[0]).toMatchObject({ pattern: "SharedKernel", source: "explicit" });
  });

  it.each([
    ["x-as-a-service", "OpenHostService"],
    ["collaboration", "Partnership"],
  ] as const)("derives %s -> %s via heuristic when unset", (mode, expectedPattern) => {
    const graph = graphWithEdges([{ kind: "interaction", from: "a", to: "b", mode }]);
    const map = deriveContextMap(graph);
    expect(map.relationships[0]).toMatchObject({ pattern: expectedPattern, source: "heuristic" });
  });

  it("does not derive a pattern for facilitating interactions", () => {
    const graph = graphWithEdges([{ kind: "interaction", from: "a", to: "b", mode: "facilitating" }]);
    const map = deriveContextMap(graph);
    expect(map.relationships[0]?.pattern).toBeUndefined();
    expect(map.relationships[0]?.source).toBe("heuristic");
  });

  it("flags a conflict when both sides declare a different mode for the same pair", () => {
    const graph = graphWithEdges([
      { kind: "interaction", from: "a", to: "b", mode: "collaboration" },
      { kind: "interaction", from: "b", to: "a", mode: "x-as-a-service" },
    ]);
    const map = deriveContextMap(graph);
    expect(map.conflicts).toHaveLength(1);
    expect(map.conflicts[0]?.description).toContain("collaboration");
    expect(map.conflicts[0]?.description).toContain("x-as-a-service");
  });

  it("does not flag agreement as a conflict", () => {
    const graph = graphWithEdges([
      { kind: "interaction", from: "a", to: "b", mode: "collaboration" },
      { kind: "interaction", from: "b", to: "a", mode: "collaboration" },
    ]);
    const map = deriveContextMap(graph);
    expect(map.conflicts).toEqual([]);
  });

  it("scopes relationships to a single team when scopeTeamId is given", () => {
    const graph = graphWithEdges([
      { kind: "interaction", from: "a", to: "b", mode: "collaboration" },
      { kind: "interaction", from: "b", to: "c", mode: "x-as-a-service" },
    ]);
    const map = deriveContextMap(graph, "a");
    expect(map.relationships).toHaveLength(1);
    expect(map.relationships[0]).toMatchObject({ from: "a", to: "b" });
  });
});
