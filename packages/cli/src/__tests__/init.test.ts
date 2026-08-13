import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_API_SCHEMA_MODELINE, TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { generateInitFiles, runInit } from "../commands/init";
import { runValidate } from "../commands/validate";
import { runGaps } from "../commands/gaps";
import { runTopology } from "../commands/topology";
import { loadConfig } from "../config";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-init-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const read = (relative: string) => fs.readFile(path.join(tmpDir, relative), "utf-8");

describe("generateInitFiles", () => {
  it("produces the config, workflow, editor settings, README and teams", () => {
    const paths = generateInitFiles({ dir: "." }).map((file) => file.relativePath.split(path.sep).join("/"));
    expect(paths).toEqual([
      "teamapi.config.yml",
      ".github/workflows/teamapi.yml",
      ".vscode/settings.json",
      "README.md",
      "teams/stream-example/teamapi.yml",
      "teams/platform-example/teamapi.yml",
    ]);
  });

  it("honours a custom teams directory everywhere it appears", () => {
    const files = generateInitFiles({ dir: ".", teamsDir: "org" });
    const byPath = new Map(files.map((f) => [f.relativePath.split(path.sep).join("/"), f.content]));
    // A teams directory that only half applied would produce a repo whose config points at
    // nothing, which is worse than not supporting the flag.
    expect(byPath.get("teamapi.config.yml")).toContain("- org");
    expect(byPath.get(".github/workflows/teamapi.yml")).toContain("patterns: org");
    expect(byPath.get(".vscode/settings.json")).toContain("org/**/teamapi.yml");
    expect([...byPath.keys()]).toContain("org/stream-example/teamapi.yml");
  });

  it("scaffolds the named teams instead of the defaults", () => {
    const paths = generateInitFiles({ dir: ".", teams: ["checkout", "platform-payments"] }).map((f) =>
      f.relativePath.split(path.sep).join("/"),
    );
    expect(paths).toContain("teams/checkout/teamapi.yml");
    expect(paths).toContain("teams/platform-payments/teamapi.yml");
    expect(paths).not.toContain("teams/stream-example/teamapi.yml");
  });

  it("gives the generated org one team of each type, so its first diagram has a shape", () => {
    const files = generateInitFiles({ dir: "." });
    const types = files
      .filter((file) => file.relativePath.endsWith("teamapi.yml") && file.relativePath.includes("teams"))
      .map((file) => (YAML.load(file.content) as { info: { type: string } }).info.type);
    expect(types.sort()).toEqual(["platform", "stream-aligned"]);
  });

  it("writes documents that validate and carry the schema modeline", () => {
    for (const file of generateInitFiles({ dir: "." })) {
      if (!file.relativePath.includes("teams")) continue;
      expect(file.content.split("\n")[0]).toBe(TEAM_API_SCHEMA_MODELINE);
      expect(() => TeamApiDocumentSchema.parse(YAML.load(file.content))).not.toThrow();
    }
  });

  it("rejects a team id the schema would not accept, naming the id", () => {
    expect(() => generateInitFiles({ dir: ".", teams: ["Not A Slug"] })).toThrow(/Not A Slug/);
  });
});

describe("runInit", () => {
  it("writes every file and exits 0", async () => {
    expect(await runInit({ dir: tmpDir })).toBe(0);
    await expect(read("teamapi.config.yml")).resolves.toContain("patterns:");
    await expect(read("teams/stream-example/teamapi.yml")).resolves.toContain("teamApiVersion");
  });

  it("creates the directory when it does not exist", async () => {
    const nested = path.join(tmpDir, "a", "b", "new-org");
    expect(await runInit({ dir: nested })).toBe(0);
    await expect(fs.readFile(path.join(nested, "teamapi.config.yml"), "utf-8")).resolves.toBeTruthy();
  });

  it("refuses to overwrite, and names every file rather than stopping at the first", async () => {
    await runInit({ dir: tmpDir });
    expect(await runInit({ dir: tmpDir })).toBe(1);

    const printed = vi
      .mocked(console.error)
      .mock.calls.map((call) => call.map(String).join(" "))
      .join("\n");
    expect(printed).toContain("teamapi.config.yml");
    expect(printed).toContain("README.md");
    expect(printed).toContain("--force");
  });

  it("overwrites under --force", async () => {
    await runInit({ dir: tmpDir });
    await fs.writeFile(path.join(tmpDir, "README.md"), "clobber me", "utf-8");
    expect(await runInit({ dir: tmpDir, force: true })).toBe(0);
    await expect(read("README.md")).resolves.not.toBe("clobber me");
  });

  it("leaves an unrelated existing file alone", async () => {
    await fs.writeFile(path.join(tmpDir, "LICENSE"), "MIT", "utf-8");
    expect(await runInit({ dir: tmpDir })).toBe(0);
    await expect(read("LICENSE")).resolves.toBe("MIT");
  });
});

/**
 * The claim `init` actually makes: not that it wrote some files, but that the repository it wrote
 * works. Every one of these runs with no patterns argument, which only succeeds if the generated
 * config is valid and points at the generated documents.
 */
describe("the generated repository", () => {
  const config = () => path.join(tmpDir, "teamapi.config.yml");
  let originalCwd: string;

  beforeEach(async () => {
    await runInit({ dir: tmpDir });
    // A real chdir, not a mocked `process.cwd()`: the generated config uses a relative
    // `patterns:`, and it is resolved by `path.resolve` and fast-glob, both of which read the
    // process's actual working directory rather than the JS function a spy would replace.
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("has a config this toolchain can parse", async () => {
    const { config: parsed } = await loadConfig({ explicitPath: config() });
    expect(parsed.patterns).toEqual(["teams"]);
  });

  it("validates with no arguments", async () => {
    expect(await runValidate([], { config: config() })).toBe(0);
  });

  it("reports no gaps with no arguments", async () => {
    expect(await runGaps([], { config: config() })).toBe(0);
  });

  it("reports no topology smells with no arguments", async () => {
    expect(await runTopology([], { config: config() })).toBe(0);
  });

  it("ships CI with the gating checks commented out", async () => {
    // A new org has no gaps; the first time it describes a real one it will, and a workflow that
    // turned red the day the documents became honest is a workflow that gets deleted.
    const ci = await read(path.join(".github", "workflows", "teamapi.yml"));
    expect(ci).toContain("# check-gaps:");
    expect(ci).not.toMatch(/^\s{10}check-gaps: "true"/m);
  });

  it("never suggests putting a token in the config", async () => {
    const generated = await read("teamapi.config.yml");
    expect(generated).not.toMatch(/^\s*#?\s*token:/m);
    expect(generated).toContain("Never put tokens here");
  });
});
