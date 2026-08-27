import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssessment, formatAssessmentText } from "../assessment/build";
import { buildOrgGraph } from "../resolve/graph-builder";

const DRIFTWOOD_SEED = path.resolve(__dirname, "../../../../examples/driftwood-org/stream-insights/teamapi.yml");

describe("organization assessment", () => {
  it("combines checks into stable findings and compares successive runs", async () => {
    const graph = await buildOrgGraph({ seedUris: [DRIFTWOOD_SEED] });
    const first = buildAssessment(graph, { now: new Date("2026-08-27T00:00:00Z") });

    expect(first.summary.total).toBeGreaterThan(0);
    expect(first.findings.every((finding) => finding.id && finding.source && finding.ruleId)).toBe(true);
    expect(first.comparison).toEqual({ baseline: true, newFindingIds: [], resolvedFindingIds: [] });

    const second = buildAssessment(graph, { previous: first.state, now: new Date("2026-08-28T00:00:00Z") });
    expect(second.comparison).toEqual({ baseline: false, newFindingIds: [], resolvedFindingIds: [] });
    expect(formatAssessmentText(second)).toContain("Since baseline: 0 new, 0 resolved.");
  });
});
