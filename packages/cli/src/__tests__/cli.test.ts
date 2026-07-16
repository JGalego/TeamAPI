import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "@teamapi/schema";
import { runValidate } from "../commands/validate";
import { runRender } from "../commands/render";
import { runScaffold } from "../commands/scaffold";

const ACME_GLOB = path.resolve(__dirname, "../../../../examples/acme-org/**/teamapi.yml");

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

  it("exits 1 when no files match", async () => {
    const code = await runValidate([path.join(tmpDir, "*.yml")]);
    expect(code).toBe(1);
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

  it("fails for scope=hierarchy without --team", async () => {
    const code = await runRender([ACME_GLOB], { scope: "hierarchy" });
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
