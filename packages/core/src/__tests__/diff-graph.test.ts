import { describe, expect, it } from "vitest";
import { diffOrgGraphs, formatOrgGraphDiff, isEmptyDiff } from "../diff/diff-graph";
import type { OrgGraph, ResolvedTeam } from "../model/org-graph";

function makeTeam(id: string, overrides: Partial<ResolvedTeam["doc"]> = {}): ResolvedTeam {
  return {
    id,
    sourceUri: `/${id}.yml`,
    doc: {
      teamApiVersion: "1.0.0" as const,
      id,
      info: { name: id, type: "stream-aligned" as const },
      channels: [],
      searchTerms: [],
      services: [],
      roles: [],
      members: [],
      meetings: [],
      interactions: [],
      dependencies: [],
      ...overrides,
    },
  };
}

function makeGraph(teams: ResolvedTeam[], overrides: Partial<OrgGraph> = {}): OrgGraph {
  return {
    teams: new Map(teams.map((t) => [t.id, t])),
    edges: [],
    roleEdges: [],
    unresolved: [],
    meta: { resolvedAt: "2026-01-01T00:00:00.000Z", sourceRoots: [] },
    ...overrides,
  };
}

describe("diffOrgGraphs", () => {
  it("is empty when nothing changed", () => {
    const graph = makeGraph([makeTeam("team-a")]);
    const diff = diffOrgGraphs(graph, graph);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("detects an added and a removed team", () => {
    const oldGraph = makeGraph([makeTeam("team-a")]);
    const newGraph = makeGraph([makeTeam("team-b")]);
    const diff = diffOrgGraphs(oldGraph, newGraph);

    expect(diff.teamsAdded).toEqual(["team-b"]);
    expect(diff.teamsRemoved).toEqual(["team-a"]);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it("detects added/removed roles, members, and services for a team present on both sides", () => {
    const oldGraph = makeGraph([
      makeTeam("team-a", {
        roles: [{ id: "old-role", name: "Old Role", kind: "Engineer", responsibilities: [], alignsWith: [] }],
        members: [{ id: "old-member", name: "Old Member", roleIds: [] }],
        services: [{ name: "old-service" }],
      }),
    ]);
    const newGraph = makeGraph([
      makeTeam("team-a", {
        roles: [{ id: "new-role", name: "New Role", kind: "Engineer", responsibilities: [], alignsWith: [] }],
        members: [{ id: "new-member", name: "New Member", roleIds: [] }],
        services: [{ name: "new-service" }],
      }),
    ]);

    const diff = diffOrgGraphs(oldGraph, newGraph);
    expect(diff.teamsChanged).toHaveLength(1);
    expect(diff.teamsChanged[0]).toMatchObject({
      teamId: "team-a",
      rolesAdded: ["new-role"],
      rolesRemoved: ["old-role"],
      membersAdded: ["new-member"],
      membersRemoved: ["old-member"],
      servicesAdded: ["new-service"],
      servicesRemoved: ["old-service"],
    });
  });

  it("does not report a team as changed when nothing about it actually differs", () => {
    const team = makeTeam("team-a", { roles: [{ id: "r", name: "R", kind: "Engineer", responsibilities: [], alignsWith: [] }] });
    const diff = diffOrgGraphs(makeGraph([team]), makeGraph([makeTeam("team-a", team.doc)]));
    expect(diff.teamsChanged).toEqual([]);
  });

  it("reports a cognitive-load change, including gaining or losing an assessment", () => {
    const oldGraph = makeGraph([
      makeTeam("team-a", { cognitiveLoad: { intrinsic: 6, extraneous: 8, germane: 4 } }), // total 18, overloaded
    ]);
    const newGraph = makeGraph([
      makeTeam("team-a", { cognitiveLoad: { intrinsic: 2, extraneous: 2, germane: 2 } }), // total 6, sustainable
    ]);

    const diff = diffOrgGraphs(oldGraph, newGraph);
    expect(diff.teamsChanged[0]?.cognitiveLoad).toEqual({
      before: { total: 18, label: "overloaded" },
      after: { total: 6, label: "sustainable" },
    });
  });

  it("reports gaining a cognitive-load assessment as before: undefined", () => {
    const oldGraph = makeGraph([makeTeam("team-a")]);
    const newGraph = makeGraph([makeTeam("team-a", { cognitiveLoad: { intrinsic: 5, extraneous: 5, germane: 5 } })]);

    const diff = diffOrgGraphs(oldGraph, newGraph);
    expect(diff.teamsChanged[0]?.cognitiveLoad?.before).toBeUndefined();
    expect(diff.teamsChanged[0]?.cognitiveLoad?.after).toEqual({ total: 15, label: "elevated" });
  });

  it("detects added/removed team-level edges by kind/from/to/detail", () => {
    const teams = [makeTeam("team-a"), makeTeam("team-b"), makeTeam("team-c")];
    const oldGraph = makeGraph(teams, {
      edges: [{ kind: "dependency", from: "team-a", to: "team-b", type: "OK" }],
    });
    const newGraph = makeGraph(teams, {
      edges: [{ kind: "dependency", from: "team-a", to: "team-c", type: "Blocking" }],
    });

    const diff = diffOrgGraphs(oldGraph, newGraph);
    expect(diff.edgesRemoved).toEqual([{ kind: "dependency", from: "team-a", to: "team-b", detail: "OK" }]);
    expect(diff.edgesAdded).toEqual([{ kind: "dependency", from: "team-a", to: "team-c", detail: "Blocking" }]);
  });

  it("treats a changed dependency type on the same from/to pair as removed+added, not unchanged", () => {
    const teams = [makeTeam("team-a"), makeTeam("team-b")];
    const oldGraph = makeGraph(teams, { edges: [{ kind: "dependency", from: "team-a", to: "team-b", type: "OK" }] });
    const newGraph = makeGraph(teams, {
      edges: [{ kind: "dependency", from: "team-a", to: "team-b", type: "Blocking" }],
    });

    const diff = diffOrgGraphs(oldGraph, newGraph);
    expect(diff.edgesRemoved).toHaveLength(1);
    expect(diff.edgesAdded).toHaveLength(1);
  });

  it("detects added/removed role edges", () => {
    const teams = [makeTeam("team-a"), makeTeam("team-b")];
    const oldGraph = makeGraph(teams, {
      roleEdges: [{ kind: "reports-to", fromTeam: "team-a", fromRole: "lead", toTeam: "team-b", toRole: "manager" }],
    });
    const newGraph = makeGraph(teams, { roleEdges: [] });

    const diff = diffOrgGraphs(oldGraph, newGraph);
    expect(diff.roleEdgesRemoved).toEqual([
      { kind: "reports-to", fromTeam: "team-a", fromRole: "lead", toTeam: "team-b", toRole: "manager" },
    ]);
    expect(diff.roleEdgesAdded).toEqual([]);
  });
});

describe("formatOrgGraphDiff", () => {
  it("renders a readable report covering every diff category", () => {
    const teams = [makeTeam("team-a"), makeTeam("team-b"), makeTeam("team-c")];
    const oldGraph = makeGraph(teams, {
      edges: [{ kind: "dependency", from: "team-a", to: "team-b", type: "OK" }],
    });
    const newGraph = makeGraph(
      [
        ...teams.filter((t) => t.id !== "team-c"),
        makeTeam("team-a", { roles: [{ id: "new-role", name: "New Role", kind: "Engineer", responsibilities: [], alignsWith: [] }] }),
        makeTeam("team-d"),
      ],
      { edges: [{ kind: "dependency", from: "team-a", to: "team-b", type: "Blocking" }] },
    );

    const diff = diffOrgGraphs(oldGraph, newGraph);
    const text = formatOrgGraphDiff(diff);

    expect(text).toContain("+ team added: team-d");
    expect(text).toContain("- team removed: team-c");
    expect(text).toContain("~ team-a");
    expect(text).toContain("+ role added: new-role");
    expect(text).toContain("Edges:");
    expect(text).toContain("- dependency team-a -> team-b (OK)");
    expect(text).toContain("+ dependency team-a -> team-b (Blocking)");
  });

  it("produces an empty string for an empty diff", () => {
    const graph = makeGraph([makeTeam("team-a")]);
    expect(formatOrgGraphDiff(diffOrgGraphs(graph, graph))).toBe("");
  });
});
