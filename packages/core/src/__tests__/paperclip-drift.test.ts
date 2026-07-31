import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import type { OrgGraph } from "../model/org-graph";
import { formatDriftReport, planPaperclipDrift, type PaperclipAgent } from "../apply/paperclip-drift";

const EXAMPLES = path.resolve(__dirname, "../../../../examples/acme-org");
let graph: OrgGraph;

/** Shaped like the generator's output, so drift detection can attribute it back to a team. */
function generated(team: string, agentId: string, name = agentId): PaperclipAgent {
  return { id: `${team}-${agentId}`, name, metadata: { teamapi: { team, agentId } } };
}

beforeAll(async () => {
  const seeds = ["enabling-devex", "platform-payments", "stream-checkout", "stream-onboarding"].map((t) =>
    path.join(EXAMPLES, t, "teamapi.yml"),
  );
  graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
});

describe("paperclip drift", () => {
  const ACTIVE = ["architecture-reviewer", "test-generator", "security-scanner", "docs-writer"];
  const allDeclared = () => ACTIVE.map((a) => generated("platform-payments", a));

  it("reports no drift when the runtime matches the spec", () => {
    const report = planPaperclipDrift(graph, "c1", allDeclared());
    expect(report.findings).toEqual([]);
    expect(report.matched).toBe(ACTIVE.length);
    expect(formatDriftReport(report)).toContain("No drift");
  });

  it("flags an agent running in Paperclip that no document declares", () => {
    const report = planPaperclipDrift(graph, "c1", [...allDeclared(), { id: "rogue-1", name: "ShadowAgent" }]);
    const undeclared = report.findings.filter((f) => f.kind === "undeclared");
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0].detail).toContain("ShadowAgent");
    expect(undeclared[0].severity).toBe("warning");
  });

  it("flags a declared, active agent with nothing running for it", () => {
    const report = planPaperclipDrift(graph, "c1", allDeclared().slice(0, 2));
    const missing = report.findings.filter((f) => f.kind === "missing").map((f) => f.agentId);
    expect(missing.sort()).toEqual(["docs-writer", "security-scanner"]);
  });

  it("does not expect an inactive agent to be running", () => {
    const report = planPaperclipDrift(graph, "c1", allDeclared());
    // compliance-auditor is status: inactive, so its absence is correct, not drift
    expect(report.findings.some((f) => f.agentId === "compliance-auditor")).toBe(false);
  });

  it("treats an agent on a policy-forbidden team as blocking", () => {
    const report = planPaperclipDrift(graph, "c1", [
      ...allDeclared(),
      generated("stream-onboarding", "kyc-helper", "KycHelper"),
    ]);
    const forbidden = report.findings.filter((f) => f.kind === "forbidden");
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0].severity).toBe("blocking");
    expect(forbidden[0].detail).toContain("no-agents-on-applicant-pii");
  });

  it("attributes hand-created agents by their scoped slug when metadata is absent", () => {
    const bare: PaperclipAgent = { id: "platform-payments-docs-writer", name: "DocsWriter" };
    const report = planPaperclipDrift(graph, "c1", [...allDeclared().slice(0, 3), bare]);
    expect(report.findings.filter((f) => f.kind === "undeclared")).toEqual([]);
    expect(report.matched).toBe(4);
  });

  it("summarises counts and marks blocking findings in the formatted report", () => {
    const report = planPaperclipDrift(graph, "c1", [generated("stream-onboarding", "kyc-helper", "KycHelper")]);
    const text = formatDriftReport(report);
    expect(text).toContain("! forbidden");
    expect(text).toMatch(/blocking/);
  });
});
