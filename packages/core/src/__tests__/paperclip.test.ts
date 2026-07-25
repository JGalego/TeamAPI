import * as path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "js-yaml";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildPaperclipPackage, type PaperclipPackage } from "../generators/paperclip";

const EXAMPLES = path.resolve(__dirname, "../../../../examples/acme-org");

async function acme(): Promise<PaperclipPackage> {
  const seeds = ["enabling-devex", "platform-payments", "stream-checkout", "stream-onboarding"].map((t) =>
    path.join(EXAMPLES, t, "teamapi.yml"),
  );
  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  return buildPaperclipPackage(graph, { name: "ACME Org" });
}

function frontmatter(content: string): Record<string, any> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  expect(match, "document should open with YAML frontmatter").not.toBeNull();
  return YAML.load(match![1]) as Record<string, any>;
}

function fileAt(pkg: PaperclipPackage, p: string): string {
  const file = pkg.files.find((f) => f.path === p);
  expect(file, `expected ${p} in package`).toBeDefined();
  return file!.content;
}

describe("paperclip generator (agentcompanies/v1)", () => {
  it("emits a company root that includes every team", async () => {
    const pkg = await acme();
    const fm = frontmatter(fileAt(pkg, "COMPANY.md"));
    expect(fm.schema).toBe("agentcompanies/v1");
    expect(fm.kind).toBe("company");
    expect(fm.slug).toBe("acme-org");
    expect(fm.includes).toEqual([
      "teams/enabling-devex/TEAM.md",
      "teams/platform-payments/TEAM.md",
      "teams/stream-checkout/TEAM.md",
      "teams/stream-onboarding/TEAM.md",
    ]);
  });

  it("scopes agent slugs by team, since agent ids are only unique within one", async () => {
    const pkg = await acme();
    const agents = pkg.files.filter((f) => f.path.startsWith("agents/")).map((f) => f.path);
    expect(agents).toContain("agents/platform-payments-architecture-reviewer/AGENTS.md");
    expect(new Set(agents).size).toBe(agents.length);
  });

  it("skips non-active agents rather than provisioning them into a runtime", async () => {
    const pkg = await acme();
    // compliance-auditor is status: inactive in the example org
    expect(pkg.skippedAgents).toContain("platform-payments/compliance-auditor");
    expect(pkg.files.some((f) => f.path.includes("compliance-auditor"))).toBe(false);
  });

  it("keeps provider and model out of the base package, under metadata", async () => {
    const pkg = await acme();
    const fm = frontmatter(fileAt(pkg, "agents/platform-payments-architecture-reviewer/AGENTS.md"));
    expect(fm.provider).toBeUndefined();
    expect(fm.model).toBeUndefined();
    expect(fm.metadata.teamapi.provider).toBeTruthy();
    expect(fm.metadata.teamapi.team).toBe("platform-payments");
  });

  it("omits reportsTo, because Team API models reporting between roles and not agents", async () => {
    const pkg = await acme();
    for (const file of pkg.files.filter((f) => f.path.startsWith("agents/"))) {
      expect(frontmatter(file.content)).not.toHaveProperty("reportsTo");
    }
  });

  it("carries the team topology type through as a tag", async () => {
    const pkg = await acme();
    expect(frontmatter(fileAt(pkg, "teams/platform-payments/TEAM.md")).tags).toEqual(["platform"]);
    expect(frontmatter(fileAt(pkg, "teams/stream-checkout/TEAM.md")).tags).toEqual(["stream-aligned"]);
  });

  it("links each team to its own agents and skills by relative path", async () => {
    const pkg = await acme();
    const fm = frontmatter(fileAt(pkg, "teams/platform-payments/TEAM.md"));
    expect(fm.includes).toContain("../../agents/platform-payments-architecture-reviewer/AGENTS.md");
    expect(fm.includes).toContain("../../skills/platform-payments-code-review/SKILL.md");
  });

  it("carries a team's policies into its TEAM.md body", async () => {
    const pkg = await acme();
    const content = fileAt(pkg, "teams/stream-onboarding/TEAM.md");
    expect(content).toContain("no-agents-on-applicant-pii");
  });

  it("gives the agent-free team no agents at all", async () => {
    const pkg = await acme();
    const fm = frontmatter(fileAt(pkg, "teams/stream-onboarding/TEAM.md"));
    const includes: string[] = fm.includes ?? [];
    expect(includes.filter((i) => i.includes("/agents/"))).toEqual([]);
  });

  it("turns prompts into skill packages", async () => {
    const pkg = await acme();
    const fm = frontmatter(fileAt(pkg, "skills/platform-payments-code-review/SKILL.md"));
    expect(fm.name).toBeTruthy();
    expect(fm.description).toBeTruthy();
    // must stay a valid Agent Skills package: no agentcompanies schema key forced onto it
    expect(fm.schema).toBeUndefined();
  });
});
