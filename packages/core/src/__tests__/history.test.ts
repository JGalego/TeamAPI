import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { formatHistory, historyToCsv, snapshotOrg, withChurn, type OrgSnapshot } from "../history/trends";
import { sampleRevisions, type GitRevision } from "../git/ref-loader";
import type { OrgGraph } from "../model/org-graph";

const ACME_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [ACME_SEED] });
});

function pointsFrom(snapshots: Array<Partial<OrgSnapshot>>) {
  const base = snapshotOrg(graph);
  return snapshots.map((overrides, i) => ({
    sha: `sha${i}`,
    date: `2026-0${i + 1}-01T00:00:00Z`,
    subject: `commit ${i}`,
    snapshot: { ...base, ...overrides },
  }));
}

describe("snapshotOrg", () => {
  it("counts what a trend line needs", () => {
    const snapshot = snapshotOrg(graph);
    expect(snapshot.teams).toBe(4);
    expect(snapshot.members).toBeGreaterThan(0);
    expect(snapshot.agents).toBeGreaterThan(0);
    expect(snapshot.teamIds).toEqual([...graph.teams.keys()].sort());
  });

  it("averages cognitive load over the teams that scored it, not over every team", () => {
    // Counting an unscored team as zero would make adopting the assessment look like the load
    // going down, which is the opposite of what happened.
    const snapshot = snapshotOrg(graph);
    const scored = [...graph.teams.values()].filter((team) => team.doc.cognitiveLoad);
    const expected = scored.reduce((sum, team) => {
      const { intrinsic, extraneous, germane } = team.doc.cognitiveLoad!;
      return sum + intrinsic + extraneous + germane;
    }, 0);
    expect(snapshot.avgCognitiveLoad).toBeCloseTo(expected / scored.length, 1);
  });

  it("counts a role nobody fills as vacant", () => {
    const snapshot = snapshotOrg(graph);
    expect(snapshot.vacantRoles).toBeGreaterThan(0);
    expect(snapshot.vacantRoles).toBeLessThan(snapshot.roles);
  });
});

describe("withChurn", () => {
  it("reports no churn on the first point", () => {
    // Every team would otherwise read as "added" at the origin, putting a spike at the left edge
    // of every chart drawn from this.
    const [first] = withChurn(pointsFrom([{ teamIds: ["a", "b"] }]));
    expect(first).toMatchObject({ teamsAdded: [], teamsRemoved: [] });
  });

  it("diffs each point against the one before it", () => {
    const points = withChurn(pointsFrom([{ teamIds: ["a", "b"] }, { teamIds: ["b", "c"] }, { teamIds: ["b", "c"] }]));
    expect(points[1]).toMatchObject({ teamsAdded: ["c"], teamsRemoved: ["a"] });
    expect(points[2]).toMatchObject({ teamsAdded: [], teamsRemoved: [] });
  });
});

describe("formatHistory", () => {
  it("says so rather than printing an empty table", () => {
    expect(formatHistory([])).toBe("No revisions to report.");
  });

  it("shows the change between first and last, which is the whole point", () => {
    const rendered = formatHistory(withChurn(pointsFrom([{ avgSupervision: 0 }, { avgSupervision: 6 }])));
    expect(rendered).toContain("change");
    expect(rendered).toContain("+6");
  });

  it("names the teams that came and went", () => {
    const rendered = formatHistory(withChurn(pointsFrom([{ teamIds: ["a", "b"] }, { teamIds: ["b", "c"] }])));
    expect(rendered).toContain("Teams added:   c");
    expect(rendered).toContain("Teams removed: a");
  });

  it("omits the change line for a single point", () => {
    expect(formatHistory(withChurn(pointsFrom([{}])))).not.toContain("change");
  });
});

describe("historyToCsv", () => {
  it("emits a header and one row per point", () => {
    const lines = historyToCsv(withChurn(pointsFrom([{}, {}]))).split("\n");
    expect(lines[0]).toContain("date,sha,teams");
    expect(lines).toHaveLength(3);
  });

  it("quotes a cell containing a comma", () => {
    const csv = historyToCsv(withChurn(pointsFrom([{ teamIds: ["a"] }, { teamIds: ["a", "b", "c"] }])));
    expect(csv).toContain("b c");
  });
});

describe("sampleRevisions", () => {
  const revisions: GitRevision[] = [
    { sha: "a", date: "2026-01-05T00:00:00Z", subject: "" },
    { sha: "b", date: "2026-01-20T00:00:00Z", subject: "" },
    { sha: "c", date: "2026-02-02T00:00:00Z", subject: "" },
    { sha: "d", date: "2026-05-02T00:00:00Z", subject: "" },
  ];

  it("keeps everything for period=commit", () => {
    expect(sampleRevisions(revisions, "commit")).toHaveLength(4);
  });

  it("keeps the last commit in each period, so a period reads as where the org ended up", () => {
    expect(sampleRevisions(revisions, "month").map((r) => r.sha)).toEqual(["b", "c", "d"]);
    expect(sampleRevisions(revisions, "quarter").map((r) => r.sha)).toEqual(["c", "d"]);
  });

  it("separates days and weeks", () => {
    expect(sampleRevisions(revisions, "day")).toHaveLength(4);
    expect(sampleRevisions(revisions, "week").length).toBeGreaterThan(1);
  });
});
