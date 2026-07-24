import { describe, expect, it } from "vitest";
import { scoreCognitiveLoad } from "../cognitive-load/score";

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
