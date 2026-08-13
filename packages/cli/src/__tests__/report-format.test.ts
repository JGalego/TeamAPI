import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runValidate } from "../commands/validate";
import { runGaps } from "../commands/gaps";
import { runPolicy } from "../commands/policy";
import { sarifLevel } from "../report-format";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const DRIFTWOOD_ROOT = path.resolve(__dirname, "../../../../examples/driftwood-org");

/** Captures stdout as the CLI writes it, so these assert on what a consumer actually pipes into
 * `jq` — not on an intermediate value the command happens to compute. */
function captureStdout() {
  const chunks: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    chunks.push(args.map(String).join(" "));
  });
  return () => chunks.join("\n");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sarifLevel", () => {
  it.each([
    ["blocking", "error"],
    ["warning", "warning"],
    ["info", "note"],
  ])("maps %s to %s", (severity, expected) => {
    expect(sarifLevel(severity)).toBe(expected);
  });
});

describe("--format json", () => {
  it("emits parseable JSON and nothing else", async () => {
    const stdout = captureStdout();
    await runValidate([ACME_ROOT], { format: "json" });
    expect(JSON.parse(stdout())).toMatchObject({ ok: true });
  });

  it("stays parseable for an org with unresolved references", async () => {
    // The case a warning line would otherwise corrupt: the human format prints one here.
    const stdout = captureStdout();
    await runGaps([DRIFTWOOD_ROOT], { format: "json" });
    expect(() => JSON.parse(stdout())).not.toThrow();
  });

  it("emits the report object itself, not a re-rendering of the text", async () => {
    const stdout = captureStdout();
    await runGaps([DRIFTWOOD_ROOT], { format: "json" });
    const report = JSON.parse(stdout()) as { findings: unknown[]; matched: number; roleTies: unknown };
    expect(report.findings.length).toBeGreaterThan(0);
    expect(report).toHaveProperty("roleTies");
  });
});

describe("--format sarif", () => {
  it("emits a valid SARIF envelope", async () => {
    const stdout = captureStdout();
    await runGaps([DRIFTWOOD_ROOT], { format: "sarif" });
    const doc = JSON.parse(stdout()) as { version: string; runs: { results: unknown[] }[] };
    expect(doc.version).toBe("2.1.0");
    expect(doc.runs[0]!.results.length).toBeGreaterThan(0);
  });

  it("points each finding at the document that declared it", async () => {
    const stdout = captureStdout();
    await runGaps([DRIFTWOOD_ROOT], { format: "sarif" });
    const doc = JSON.parse(stdout()) as {
      runs: { results: { locations?: { physicalLocation: { artifactLocation: { uri: string } } }[] }[] }[];
    };
    const uris = doc.runs[0]!.results.flatMap(
      (r) => r.locations?.map((l) => l.physicalLocation.artifactLocation.uri) ?? [],
    );
    expect(uris.every((uri) => uri.endsWith("teamapi.yml"))).toBe(true);
    expect(uris.some((uri) => uri.includes("driftwood-org"))).toBe(true);
  });

  it("raises a blocking finding to SARIF error, which is what fails a required check", async () => {
    const stdout = captureStdout();
    await runGaps([DRIFTWOOD_ROOT], { format: "sarif" });
    const doc = JSON.parse(stdout()) as { runs: { results: { ruleId: string; level: string }[] }[] };
    const orphan = doc.runs[0]!.results.find((r) => r.ruleId === "orphan-subscription");
    expect(orphan?.level).toBe("error");
  });

  it("carries policy outcomes as rule ids", async () => {
    const stdout = captureStdout();
    await runPolicy([ACME_ROOT], { format: "sarif" });
    const doc = JSON.parse(stdout()) as { runs: { results: { ruleId: string; level: string }[] }[] };
    expect(doc.runs[0]!.results.map((r) => r.ruleId)).toContain("delegated");
  });
});

describe("exit codes", () => {
  it("are unchanged by the output format", async () => {
    captureStdout();
    // The format decides how findings are printed, never whether they fail the build.
    const text = await runGaps([DRIFTWOOD_ROOT]);
    const json = await runGaps([DRIFTWOOD_ROOT], { format: "json" });
    const sarif = await runGaps([DRIFTWOOD_ROOT], { format: "sarif" });
    expect([text, json, sarif]).toEqual([1, 1, 1]);
  });
});
