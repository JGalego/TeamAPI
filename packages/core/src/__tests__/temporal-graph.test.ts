import { describe, expect, it } from "vitest";
import type { OrgGraph, ResolvedTeam } from "../model/org-graph";
import { buildTemporalOrgGraph, orgAtDate, teamAtDate, teamLifecycle } from "../history/temporal-graph";

function team(id: string, members: string[] = [], roles: string[] = [], services: string[] = []): ResolvedTeam {
  return {
    id,
    sourceUri: `${id}.yml`,
    doc: {
      teamApiVersion: "1.0.0",
      id,
      info: { name: id, type: "stream-aligned" },
      channels: [],
      searchTerms: [],
      services: services.map((name) => ({ name })),
      roles: roles.map((roleId) => ({
        id: roleId,
        name: roleId,
        kind: "Engineer",
        responsibilities: [],
        alignsWith: [],
      })),
      members: members.map((memberId) => ({ id: memberId, name: memberId, roleIds: [] })),
      meetings: [],
      interactions: [],
      dependencies: [],
      agents: [],
      memory: [],
      specifications: [],
      steeringDocuments: [],
      prompts: [],
      playbooks: [],
      policies: [],
      knowledgeBase: [],
      workflows: [],
      sessions: [],
    },
  };
}

function graph(...teams: ResolvedTeam[]): OrgGraph {
  return {
    teams: new Map(teams.map((entry) => [entry.id, entry])),
    edges: [],
    roleEdges: [],
    unresolved: [],
    meta: { resolvedAt: "2026-01-01T00:00:00Z", sourceRoots: [] },
  };
}

describe("temporal org graph", () => {
  const temporal = buildTemporalOrgGraph([
    { sha: "c", date: "2026-03-01T00:00:00Z", graph: graph() },
    { sha: "a", date: "2026-01-01T00:00:00Z", graph: graph(team("payments", ["ada"], ["lead"])) },
    {
      sha: "b",
      date: "2026-02-01T00:00:00Z",
      graph: graph(team("payments", ["ada", "grace"], ["lead"], ["ledger-api"])),
    },
  ]);

  it("orders revisions and returns the latest state at a date", () => {
    expect(temporal.points.map((point) => point.sha)).toEqual(["a", "b", "c"]);
    expect(orgAtDate(temporal, "2026-02-15")?.sha).toBe("b");
    expect(orgAtDate(temporal, "2025-12-01")).toBeUndefined();
  });

  it("queries a team at a point in time", () => {
    expect(teamAtDate(temporal, "payments", "2026-01-15")?.doc.members).toHaveLength(1);
    expect(teamAtDate(temporal, "payments", "2026-03-02")).toBeUndefined();
  });

  it("builds an evidence-friendly team lifecycle", () => {
    expect(teamLifecycle(temporal, "payments")).toEqual([
      { date: "2026-01-01T00:00:00Z", sha: "a", kind: "created", added: ["payments"], removed: [] },
      { date: "2026-02-01T00:00:00Z", sha: "b", kind: "members-changed", added: ["grace"], removed: [] },
      {
        date: "2026-02-01T00:00:00Z",
        sha: "b",
        kind: "services-changed",
        added: ["ledger-api"],
        removed: [],
      },
      { date: "2026-03-01T00:00:00Z", sha: "c", kind: "removed", added: [], removed: ["payments"] },
    ]);
  });

  it("rejects duplicate revisions", () => {
    expect(() =>
      buildTemporalOrgGraph([
        { sha: "same", date: "2026-01-01", graph: graph() },
        { sha: "same", date: "2026-02-01", graph: graph() },
      ]),
    ).toThrow(/Duplicate temporal graph revision/);
  });
});
