import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, EMPTY_CONFIG, findConfigFile, loadConfig } from "../config";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-config-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeConfig(body: string, dir = tmpDir, name = "teamapi.config.yml") {
  const file = path.join(dir, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, body, "utf-8");
  return file;
}

describe("findConfigFile", () => {
  it("finds a config in the starting directory", async () => {
    const file = await writeConfig("gaps: {}");
    expect(await findConfigFile(tmpDir)).toBe(file);
  });

  it("walks up to find one in an ancestor", async () => {
    const file = await writeConfig("gaps: {}");
    const nested = path.join(tmpDir, "teams", "stream-a");
    await fs.mkdir(nested, { recursive: true });
    // A config that only applied when you stood in the right directory is one people stop trusting.
    expect(await findConfigFile(nested)).toBe(file);
  });

  it("accepts the .yaml spelling too", async () => {
    const file = await writeConfig("gaps: {}", tmpDir, "teamapi.config.yaml");
    expect(await findConfigFile(tmpDir)).toBe(file);
  });
});

describe("loadConfig", () => {
  it("returns an empty config when there is no file", async () => {
    // `/` will not contain one, and walking up from a temp dir would otherwise find the repo's.
    const deep = path.join(tmpDir, "a", "b");
    await fs.mkdir(deep, { recursive: true });
    const { config, sourcePath } = await loadConfig({ cwd: deep });
    // The repo checkout above tmp has no config, so this genuinely finds nothing.
    expect(sourcePath).toBeUndefined();
    expect(config).toEqual(EMPTY_CONFIG);
  });

  it("parses severity overrides and waivers", async () => {
    const file = await writeConfig(`
gaps:
  severity:
    unconsumed-event: "off"
    orphan-subscription: warning
  waivers:
    - kind: dangling-owner
      teamId: platform-data
      reason: Owner leaves at the end of the quarter
      expires: "2026-12-31"
`);
    const { config, sourcePath } = await loadConfig({ explicitPath: file });
    expect(sourcePath).toBe(file);
    expect(config.gaps.severity).toEqual({ "unconsumed-event": "off", "orphan-subscription": "warning" });
    expect(config.gaps.waivers[0]).toMatchObject({ kind: "dangling-owner", teamId: "platform-data" });
  });

  it("rejects a waiver with no reason", async () => {
    // A waiver whose reason is missing is indistinguishable later from one added to green a build.
    const file = await writeConfig(`
gaps:
  waivers:
    - kind: dangling-owner
`);
    await expect(loadConfig({ explicitPath: file })).rejects.toThrow(ConfigError);
  });

  it("rejects an unknown top-level key rather than ignoring it", async () => {
    const file = await writeConfig("gapz:\n  severity: {}\n");
    await expect(loadConfig({ explicitPath: file })).rejects.toThrow(ConfigError);
  });

  it("rejects a misspelled key inside gaps", async () => {
    const file = await writeConfig("gaps:\n  waviers: []\n");
    await expect(loadConfig({ explicitPath: file })).rejects.toThrow(/waviers|Unrecognized/);
  });

  it("rejects an unknown gap kind, which would otherwise silently do nothing", async () => {
    const file = await writeConfig("gaps:\n  severity:\n    orphan-subscriptions: warning\n");
    await expect(loadConfig({ explicitPath: file })).rejects.toThrow(/unknown gap kind/);
  });

  it("rejects an unknown gap kind in a waiver too", async () => {
    const file = await writeConfig("gaps:\n  waivers:\n    - kind: nonsense\n      reason: because\n");
    await expect(loadConfig({ explicitPath: file })).rejects.toThrow(/unknown gap kind/);
  });

  it("rejects a malformed expiry date", async () => {
    const file = await writeConfig(`
gaps:
  waivers:
    - kind: dangling-owner
      reason: soon
      expires: "next tuesday"
`);
    await expect(loadConfig({ explicitPath: file })).rejects.toThrow(ConfigError);
  });

  it("reports a YAML syntax error against the file it came from", async () => {
    const file = await writeConfig("gaps: {{{");
    await expect(loadConfig({ explicitPath: file })).rejects.toThrow(new RegExp(file.replace(/\\/g, "\\\\")));
  });

  it("errors when an explicitly named config does not exist", async () => {
    await expect(loadConfig({ explicitPath: path.join(tmpDir, "nope.yml") })).rejects.toThrow(ConfigError);
  });

  it("treats an empty file as an empty config", async () => {
    const file = await writeConfig("");
    expect((await loadConfig({ explicitPath: file })).config).toEqual(EMPTY_CONFIG);
  });
});
