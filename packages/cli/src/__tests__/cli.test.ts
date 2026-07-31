import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { runValidate } from "../commands/validate";
import { runGaps } from "../commands/gaps";
import { runShadowAi } from "../commands/shadow-ai";
import { runRender } from "../commands/render";
import { runScaffold } from "../commands/scaffold";
import { runGenerate } from "../commands/generate";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const ACME_GLOB = path.join(ACME_ROOT, "**/teamapi.yml");
const DRIFTWOOD_ROOT = path.resolve(__dirname, "../../../../examples/driftwood-org");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-cli-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("teamapi validate", () => {
  it("exits 0 for the example org", async () => {
    const code = await runValidate([ACME_GLOB]);
    expect(code).toBe(0);
  });

  it("exits 0 when pointed at the example org folder directly (no glob needed)", async () => {
    const code = await runValidate([ACME_ROOT]);
    expect(code).toBe(0);
  });

  it("exits 1 when no files match", async () => {
    const code = await runValidate([path.join(tmpDir, "*.yml")]);
    expect(code).toBe(1);
  });
});

describe("teamapi gaps", () => {
  it("exits 0 for the example org — it has warnings, but nothing blocking", async () => {
    const code = await runGaps([ACME_GLOB]);
    expect(code).toBe(0);
  });

  it("exits 1 for the deliberately broken org", async () => {
    const code = await runGaps([DRIFTWOOD_ROOT]);
    expect(code).toBe(1);
  });

  it("exits 1 when no files match", async () => {
    const code = await runGaps([path.join(tmpDir, "*.yml")]);
    expect(code).toBe(1);
  });
});

describe("teamapi shadow-ai", () => {
  const seedRepo = async (name: string, files: Record<string, string>) => {
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(tmpDir, name, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf-8");
    }
  };

  it("exits 0 when the only AI usage is in a repo whose team declares agents", async () => {
    await seedRepo("payments-api", { ".mcp.json": "{}" });
    expect(await runShadowAi([ACME_GLOB], { scan: tmpDir })).toBe(0);
  });

  it("exits 1 when AI artifacts appear in a repo whose team's policy forbids agents", async () => {
    await seedRepo("onboarding-api", { ".mcp.json": "{}" });
    expect(await runShadowAi([ACME_GLOB], { scan: tmpDir })).toBe(1);
  });

  it("exits 1 when the scan directory does not exist", async () => {
    expect(await runShadowAi([ACME_GLOB], { scan: path.join(tmpDir, "nope") })).toBe(1);
  });

  it("exits 1 when the scan directory holds no repositories", async () => {
    expect(await runShadowAi([ACME_GLOB], { scan: tmpDir })).toBe(1);
  });

  it("exits 1 when no files match", async () => {
    await seedRepo("payments-api", { ".mcp.json": "{}" });
    expect(await runShadowAi([path.join(tmpDir, "*.yml")], { scan: tmpDir })).toBe(1);
  });
});

describe("teamapi render", () => {
  it("writes a topology diagram to --out", async () => {
    const outFile = path.join(tmpDir, "topology.mmd");
    const code = await runRender([ACME_GLOB], { scope: "topology", format: "mermaid", out: outFile });
    expect(code).toBe(0);
    const content = await fs.readFile(outFile, "utf-8");
    expect(content).toContain("flowchart LR");
  });

  it("draws agents attached to their owners with --with-agents", async () => {
    const outFile = path.join(tmpDir, "with-agents.mmd");
    const code = await runRender([ACME_GLOB], {
      scope: "org-hierarchy",
      format: "mermaid",
      out: outFile,
      withAgents: true,
    });
    expect(code).toBe(0);
    const content = await fs.readFile(outFile, "utf-8");
    expect(content).toContain("🤖 Test Generator (agent)");
    expect(content).toContain('|"supervises"|');
  });

  it("rejects --with-agents on a scope it does not apply to", async () => {
    expect(await runRender([ACME_GLOB], { scope: "topology", withAgents: true })).toBe(1);
  });

  it("fails for scope=hierarchy without --team", async () => {
    const code = await runRender([ACME_GLOB], { scope: "hierarchy" });
    expect(code).toBe(1);
  });

  it("writes an org-hierarchy diagram grouped into boxes per team", async () => {
    const outFile = path.join(tmpDir, "org-hierarchy.mmd");
    const code = await runRender([ACME_GLOB], { scope: "org-hierarchy", format: "mermaid", out: outFile });
    expect(code).toBe(0);
    const content = await fs.readFile(outFile, "utf-8");
    expect(content).toContain("subgraph");
    expect(content).toContain("aligns with");
  });
});

describe("teamapi generate", () => {
  it("writes one crew's agents/tasks YAML when scoped with --team", async () => {
    const outDir = path.join(tmpDir, "crewai-checkout");
    const code = await runGenerate([ACME_GLOB], { target: "crewai", team: "stream-checkout", out: outDir });
    expect(code).toBe(0);

    const agents = YAML.load(await fs.readFile(path.join(outDir, "agents.yaml"), "utf-8"));
    expect(agents).toHaveProperty("tech_lead.role", "Checkout Tech Lead");
    await expect(fs.access(path.join(outDir, "org.yaml"))).rejects.toThrow();
  });

  it("writes org.yaml plus a per-team crew directory for the whole org", async () => {
    const outDir = path.join(tmpDir, "crewai-org");
    const code = await runGenerate([ACME_GLOB], { target: "crewai", out: outDir });
    expect(code).toBe(0);

    const org = YAML.load(await fs.readFile(path.join(outDir, "org.yaml"), "utf-8"));
    expect(org).toHaveProperty("crews.platform-payments.process", "hierarchical");

    const checkoutAgents = YAML.load(await fs.readFile(path.join(outDir, "stream-checkout", "agents.yaml"), "utf-8"));
    expect(checkoutAgents).toHaveProperty("backend_engineer.role", "Checkout Backend Engineer");
  });

  it("fails for an unknown --team id", async () => {
    const outDir = path.join(tmpDir, "crewai-bad-team");
    const code = await runGenerate([ACME_GLOB], { target: "crewai", team: "does-not-exist", out: outDir });
    expect(code).toBe(1);
  });

  it("writes a single catalog-info.yaml for one team when scoped with --team backstage", async () => {
    const outDir = path.join(tmpDir, "backstage-checkout");
    const code = await runGenerate([ACME_GLOB], { target: "backstage", team: "stream-checkout", out: outDir });
    expect(code).toBe(0);

    const docs = YAML.loadAll(await fs.readFile(path.join(outDir, "catalog-info.yaml"), "utf-8")) as Array<{
      kind: string;
      metadata: { name: string };
    }>;
    expect(docs.some((d) => d.kind === "Group" && d.metadata.name === "stream-checkout")).toBe(true);
    expect(docs.some((d) => d.kind === "Component" && d.metadata.name === "checkout-api")).toBe(true);
  });

  it("writes a single combined catalog-info.yaml for the whole org with backstage", async () => {
    const outDir = path.join(tmpDir, "backstage-org");
    const code = await runGenerate([ACME_GLOB], { target: "backstage", out: outDir });
    expect(code).toBe(0);

    const docs = YAML.loadAll(await fs.readFile(path.join(outDir, "catalog-info.yaml"), "utf-8")) as Array<{
      kind: string;
      metadata: { name: string };
    }>;
    const groupNames = docs.filter((d) => d.kind === "Group").map((d) => d.metadata.name);
    expect(groupNames.sort()).toEqual(["enabling-devex", "platform-payments", "stream-checkout", "stream-onboarding"]);
  });

  it("fails for an unknown --team id with backstage too", async () => {
    const outDir = path.join(tmpDir, "backstage-bad-team");
    const code = await runGenerate([ACME_GLOB], { target: "backstage", team: "does-not-exist", out: outDir });
    expect(code).toBe(1);
  });
});

describe("teamapi scaffold", () => {
  it("produces a document that round-trips through schema validation", async () => {
    const outFile = path.join(tmpDir, "teamapi.yml");
    const code = await runScaffold({ id: "new-stream-team", type: "stream-aligned", out: outFile });
    expect(code).toBe(0);

    const raw = YAML.load(await fs.readFile(outFile, "utf-8"));
    const parsed = TeamApiDocumentSchema.parse(raw);
    expect(parsed.id).toBe("new-stream-team");
    expect(parsed.info.type).toBe("stream-aligned");
  });
});
