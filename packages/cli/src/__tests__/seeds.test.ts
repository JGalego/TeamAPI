import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandSeeds } from "../seeds";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-seeds-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("expandSeeds", () => {
  it("discovers the same files from a bare directory as from an explicit ** glob", async () => {
    const fromDir = await expandSeeds([ACME_ROOT]);
    const fromGlob = await expandSeeds([path.join(ACME_ROOT, "**/teamapi.yml")]);
    expect(fromDir).toEqual(fromGlob);
    expect(fromDir.length).toBe(4);
  });

  it("also discovers .yaml (not just .yml) under a directory", async () => {
    const teamDir = path.join(tmpDir, "solo-team");
    await fs.mkdir(teamDir, { recursive: true });
    await fs.writeFile(path.join(teamDir, "teamapi.yaml"), "id: solo-team\n", "utf-8");

    const seeds = await expandSeeds([tmpDir]);
    expect(seeds).toEqual([path.join(teamDir, "teamapi.yaml")]);
  });

  it("still treats non-directory patterns as literal paths / globs", async () => {
    const file = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");
    const seeds = await expandSeeds([file]);
    expect(seeds).toEqual([file]);
  });

  it("de-duplicates when the same file is reachable through multiple patterns", async () => {
    const file = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");
    const seeds = await expandSeeds([file, ACME_ROOT]);
    expect(seeds.filter((s) => s === file)).toHaveLength(1);
  });

  it("returns an empty list for a directory with no teamapi.yml/yaml files", async () => {
    const seeds = await expandSeeds([tmpDir]);
    expect(seeds).toEqual([]);
  });
});
