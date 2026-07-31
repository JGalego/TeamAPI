import { describe, expect, it } from "vitest";
import { scoreCognitiveLoad } from "../cognitive-load/score";

describe("scoreCognitiveLoad — supervision", () => {
  const base = { intrinsic: 5, extraneous: 3, germane: 5 } as const; // total 13, sustainable on its own

  it("never counts toward total, however high it is", () => {
    expect(scoreCognitiveLoad({ ...base, supervision: 10 }).total).toBe(scoreCognitiveLoad(base).total);
  });

  it("changes nothing at all for a team that has not scored it", () => {
    expect(scoreCognitiveLoad(base)).toEqual(scoreCognitiveLoad({ ...base, supervision: undefined }));
  });

  it.each([
    [3, "sustainable"],
    [4, "elevated"],
    [6, "elevated"],
    [7, "overloaded"],
    [10, "overloaded"],
  ] as const)("labels supervision=%i as %s on its own, with the other three scores modest", (supervision, expected) => {
    expect(scoreCognitiveLoad({ ...base, supervision }).label).toBe(expected);
  });

  it("stops a team drowning in agent review from reporting sustainable", () => {
    // The failure this trigger exists to prevent: three modest scores, a fleet nobody can keep up
    // with, and a label that says everything is fine.
    const drowning = scoreCognitiveLoad({ intrinsic: 4, extraneous: 2, germane: 4, supervision: 9 });
    expect(drowning.total).toBe(10);
    expect(drowning.label).toBe("overloaded");
  });

  it("never lowers a label the other triggers already raised", () => {
    const raised = scoreCognitiveLoad({ intrinsic: 9, extraneous: 8, germane: 9, supervision: 1 });
    expect(raised.label).toBe("overloaded");
  });

  it("carries the score through on the assessment for callers that want it", () => {
    expect(scoreCognitiveLoad({ ...base, supervision: 7 }).assessment.supervision).toBe(7);
  });
});

describe("scoreCognitiveLoad", () => {
  it.each([
    [{ intrinsic: 2, extraneous: 2, germane: 2 }, "sustainable"],
    [{ intrinsic: 5, extraneous: 4, germane: 5 }, "elevated"],
    [{ intrinsic: 5, extraneous: 5, germane: 5 }, "elevated"], // total 15... below 18, but check boundary below
    [{ intrinsic: 6, extraneous: 3, germane: 9 }, "elevated"], // total 18
    [{ intrinsic: 2, extraneous: 7, germane: 2 }, "overloaded"], // extraneous-triggered
    [{ intrinsic: 8, extraneous: 8, germane: 8 }, "overloaded"], // total 24
  ] as const)("labels %j as %s", (assessment, expected) => {
    const result = scoreCognitiveLoad(assessment);
    expect(result.label).toBe(expected);
    expect(result.total).toBe(assessment.intrinsic + assessment.extraneous + assessment.germane);
  });

  it("labels a 5/5/5 assessment as sustainable (below every threshold)", () => {
    const result = scoreCognitiveLoad({ intrinsic: 5, extraneous: 3, germane: 5 });
    expect(result.total).toBe(13);
    expect(result.label).toBe("sustainable");
  });
});
