import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { formatShadowAi, planShadowAi, repoNameFromUrl } from "../shadow-ai/plan";
import { scanForAiArtifacts, type ScannedRepo } from "../shadow-ai/scan";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const acme = () => buildOrgGraph({ seedUris: [path.join(ACME_ROOT, "stream-checkout/teamapi.yml")] });

/** ACME's declared repositories, by owning team:
 *  platform-payments  -> payments-api, ledger   (five agents declared)
 *  stream-checkout    -> checkout-api           (no agents[])
 *  stream-onboarding  -> onboarding-api         (no agents[], policy forbids them) */
const repo = (name: string, artifacts: ScannedRepo["artifacts"] = []): ScannedRepo => ({ name, artifacts });
const mcp = [{ kind: "mcp-config" as const, path: ".mcp.json" }];

describe("repoNameFromUrl", () => {
  it.each([
    ["https://github.com/acme-example/checkout-api", "checkout-api"],
    ["https://github.com/acme-example/checkout-api.git", "checkout-api"],
    ["https://github.com/acme-example/checkout-api/", "checkout-api"],
    ["git@github.com:acme-example/Checkout-API", "checkout-api"],
    ["https://github.com/acme-example/checkout-api?tab=readme", "checkout-api"],
  ])("reduces %s to %s", (url, expected) => {
    expect(repoNameFromUrl(url)).toBe(expected);
  });
});

describe("planShadowAi", () => {
  it("blocks when artifacts turn up in a repo whose team forbids agents", async () => {
    const report = planShadowAi(await acme(), [repo("onboarding-api", mcp)]);
    expect(report.findings).toEqual([
      {
        kind: "forbidden",
        severity: "blocking",
        teamId: "stream-onboarding",
        subject: "onboarding-api",
        detail:
          "'onboarding-api' carries AI artifacts (.mcp.json) but stream-onboarding's policy 'no-agents-on-applicant-pii' forbids agents",
      },
    ]);
  });

  it("warns when artifacts turn up in a repo whose team declares no agents", async () => {
    const report = planShadowAi(await acme(), [repo("checkout-api", mcp)]);
    expect(report.findings).toMatchObject([{ kind: "undeclared", severity: "warning", teamId: "stream-checkout" }]);
  });

  it("warns when artifacts turn up in a repo no team declares", async () => {
    const report = planShadowAi(await acme(), [repo("legacy-batch", mcp)]);
    expect(report.findings).toMatchObject([{ kind: "unowned", severity: "warning", subject: "legacy-batch" }]);
    expect(report.findings[0]!.teamId).toBeUndefined();
  });

  it("counts a declaring team's repo as matched rather than a finding", async () => {
    const report = planShadowAi(await acme(), [repo("payments-api", mcp)]);
    expect(report.findings).toEqual([]);
    expect(report.matched).toBe(1);
  });

  it("warns when a team declares active agents but its scanned repos carry no trace", async () => {
    const report = planShadowAi(await acme(), [repo("payments-api"), repo("ledger")]);
    expect(report.findings).toMatchObject([{ kind: "declared-unseen", teamId: "platform-payments" }]);
    // Four of the five ACME agents are active; the compliance auditor is paused.
    expect(report.findings[0]!.detail).toContain("4 active agent(s)");
    expect(report.quiet).toBe(2);
  });

  it("says nothing about teams whose repos were not part of the scan", async () => {
    const report = planShadowAi(await acme(), [repo("checkout-api")]);
    expect(report.findings).toEqual([]);
    expect(report.quiet).toBe(1);
  });

  it("truncates a long artifact list rather than printing all of it", async () => {
    const many = ["a", "b", "c", "d", "e"].map((p) => ({ kind: "agent-instructions" as const, path: p }));
    const report = planShadowAi(await acme(), [repo("checkout-api", many)]);
    expect(report.findings[0]!.detail).toContain("a, b, c, +2 more");
  });
});

describe("formatShadowAi", () => {
  it("reports how many repos were quiet, so an empty tree can't read as a clean result", async () => {
    // Neither team declares agents, so a quiet repo is the expected state for both.
    const out = formatShadowAi(planShadowAi(await acme(), [repo("checkout-api"), repo("onboarding-api")]));
    expect(out).toBe("No shadow AI. 2 repo(s) scanned, 2 with no AI artifacts at all.");
  });

  it("prefixes each kind with its glyph and ends with a counted summary", async () => {
    const out = formatShadowAi(
      planShadowAi(await acme(), [
        repo("onboarding-api", mcp),
        repo("checkout-api", mcp),
        repo("legacy-batch", mcp),
        repo("payments-api", mcp),
      ]),
    );
    expect(out).toContain("! forbidden:");
    expect(out).toContain("+ undeclared:");
    expect(out).toContain("? unowned:");
    expect(out).toContain("3 finding(s), 1 blocking; 1 repo(s) matched, 0 quiet.");
  });
});

describe("scanForAiArtifacts", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "teamapi-scan-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (relative: string, content = "") => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf-8");
  };

  it("finds marker files and directories", async () => {
    await write("repo-a/.mcp.json", "{}");
    await write("repo-a/CLAUDE.md", "# instructions");
    await write("repo-a/.claude/settings.json", "{}");

    const [scanned] = await scanForAiArtifacts(root);
    expect(scanned!.name).toBe("repo-a");
    expect(scanned!.artifacts).toEqual([
      { kind: "mcp-config", path: ".mcp.json" },
      { kind: "agent-instructions", path: "CLAUDE.md" },
      { kind: "assistant-config", path: ".claude/" },
    ]);
  });

  it("finds LLM SDKs in package.json across both dependency blocks", async () => {
    await write(
      "repo-b/package.json",
      JSON.stringify({ dependencies: { "@anthropic-ai/sdk": "^1", express: "^4" }, devDependencies: { openai: "^5" } }),
    );
    const [scanned] = await scanForAiArtifacts(root);
    expect(scanned!.artifacts).toEqual([
      { kind: "llm-dependency", path: "package.json", detail: "@anthropic-ai/sdk" },
      { kind: "llm-dependency", path: "package.json", detail: "openai" },
    ]);
  });

  it("finds LLM SDKs in requirements.txt, ignoring version pins and comments", async () => {
    await write("repo-c/requirements.txt", "# deps\nrequests==2.31.0\nlangchain>=0.2\nopenai[datalib]==1.2\n\n");
    const [scanned] = await scanForAiArtifacts(root);
    expect(scanned!.artifacts.map((a) => a.detail)).toEqual(["langchain", "openai"]);
  });

  it("finds a workflow step that calls a model, once per file", async () => {
    await write(
      "repo-d/.github/workflows/review.yml",
      "jobs:\n  review:\n    steps:\n      - uses: actions/checkout@v7\n      - uses: anthropics/claude-code-action@v1\n      - uses: anthropics/claude-code-action@v1\n",
    );
    const [scanned] = await scanForAiArtifacts(root);
    expect(scanned!.artifacts).toEqual([
      { kind: "ai-workflow", path: ".github/workflows/review.yml", detail: "anthropics/claude-code-action@v1" },
    ]);
  });

  it("reports a repo with nothing in it as scanned but empty", async () => {
    await write("repo-e/README.md", "# nothing to see");
    await write("repo-e/package.json", JSON.stringify({ dependencies: { express: "^4" } }));
    const [scanned] = await scanForAiArtifacts(root);
    expect(scanned).toEqual({ name: "repo-e", artifacts: [] });
  });

  it("survives an unparseable package.json rather than treating it as evidence", async () => {
    await write("repo-f/package.json", "{ not json");
    const [scanned] = await scanForAiArtifacts(root);
    expect(scanned!.artifacts).toEqual([]);
  });

  it("ignores loose files at the scan root and returns repos sorted", async () => {
    await write("notes.md", "loose file");
    await write("zulu/.mcp.json", "{}");
    await write("alpha/.mcp.json", "{}");
    expect((await scanForAiArtifacts(root)).map((r) => r.name)).toEqual(["alpha", "zulu"]);
  });
});
