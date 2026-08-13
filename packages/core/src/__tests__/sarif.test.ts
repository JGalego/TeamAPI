import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSarif } from "../report/sarif";

const base = {
  toolName: "teamapi gaps",
  rules: [{ id: "orphan-subscription", description: "A subscription with no publisher" }],
};

describe("buildSarif", () => {
  it("produces a 2.1.0 document with one run", () => {
    const doc = buildSarif({ ...base, findings: [] });
    expect(doc.version).toBe("2.1.0");
    expect((doc.runs as unknown[]).length).toBe(1);
  });

  it("declares every rule, so results are not dropped on ingest", () => {
    const doc = buildSarif({ ...base, findings: [] });
    const rules = (doc.runs as { tool: { driver: { rules: { id: string }[] } } }[])[0]!.tool.driver.rules;
    expect(rules.map((r) => r.id)).toEqual(["orphan-subscription"]);
  });

  it("emits paths relative to baseDir, since consumers resolve them against the repo root", () => {
    const baseDir = path.join(path.sep, "home", "runner", "work", "org");
    const doc = buildSarif({
      ...base,
      baseDir,
      findings: [
        {
          ruleId: "orphan-subscription",
          level: "error",
          message: "broken",
          filePath: path.join(baseDir, "teams", "a", "teamapi.yml"),
        },
      ],
    });
    const results = (
      doc.runs as { results: { locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[]
    )[0]!.results;
    // Forward slashes regardless of host platform, and no absolute CI path — which would match no
    // file in the repository and make the annotation silently disappear.
    expect(results[0]!.locations[0]!.physicalLocation.artifactLocation.uri).toBe("teams/a/teamapi.yml");
  });

  it("omits locations for a finding with no file", () => {
    const doc = buildSarif({
      ...base,
      findings: [{ ruleId: "orphan-subscription", level: "note", message: "no file" }],
    });
    const results = (doc.runs as { results: Record<string, unknown>[] }[])[0]!.results;
    expect(results[0]!.locations).toBeUndefined();
  });

  it("carries the level through, which is what decides a failing check from an advisory one", () => {
    const doc = buildSarif({
      ...base,
      findings: [
        { ruleId: "orphan-subscription", level: "error", message: "a" },
        { ruleId: "orphan-subscription", level: "warning", message: "b" },
        { ruleId: "orphan-subscription", level: "note", message: "c" },
      ],
    });
    const results = (doc.runs as { results: { level: string }[] }[])[0]!.results;
    expect(results.map((r) => r.level)).toEqual(["error", "warning", "note"]);
  });
});
