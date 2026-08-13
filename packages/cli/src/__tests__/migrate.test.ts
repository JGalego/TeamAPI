import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrate } from "../commands/migrate";
import { runValidate } from "../commands/validate";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-migrate-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function writeTeam(name: string, body: string) {
  const dir = path.join(tmpDir, name);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "teamapi.yml");
  await fs.writeFile(file, body, "utf-8");
  return file;
}

const doc = (version: string | null, id: string) =>
  `${version === null ? "" : `teamApiVersion: "${version}"\n`}id: ${id}\ninfo:\n  name: ${id}\n  type: platform\n`;

const printed = () =>
  [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
    .map((call) => call.map(String).join(" "))
    .join("\n");

describe("runMigrate", () => {
  it("exits 0 and says so when everything is current", async () => {
    await writeTeam("a", doc("1.0.0", "team-a"));
    expect(await runMigrate([tmpDir], { noConfig: true })).toBe(0);
    expect(printed()).toContain("already at 1.0.0");
  });

  it("exits 1 for a document newer than this build, telling the reader to upgrade", async () => {
    await writeTeam("a", doc("2.0.0", "team-a"));
    expect(await runMigrate([tmpDir], { noConfig: true })).toBe(1);
    expect(printed()).toMatch(/newer than this build/);
    expect(printed()).toMatch(/Upgrade @jgalego\/teamapi/);
  });

  it("exits 1 for a document older than any registered migration", async () => {
    await writeTeam("a", doc("0.9.0", "team-a"));
    expect(await runMigrate([tmpDir], { noConfig: true })).toBe(1);
    expect(printed()).toMatch(/No migration path from 0\.9\.0/);
  });

  it("exits 1 for a document with no version, naming the field to add", async () => {
    await writeTeam("a", doc(null, "team-a"));
    expect(await runMigrate([tmpDir], { noConfig: true })).toBe(1);
    expect(printed()).toContain("teamApiVersion");
  });

  it("reports each file separately rather than stopping at the first problem", async () => {
    await writeTeam("future", doc("2.0.0", "team-a"));
    await writeTeam("old", doc("0.9.0", "team-b"));
    await writeTeam("current", doc("1.0.0", "team-c"));

    await runMigrate([tmpDir], { noConfig: true });
    const output = printed();
    expect(output).toMatch(/newer than this build/);
    expect(output).toMatch(/No migration path/);
    expect(output).toContain("1 already current");
  });

  it("never rewrites a file it cannot migrate", async () => {
    const file = await writeTeam("a", doc("2.0.0", "team-a"));
    const before = await fs.readFile(file, "utf-8");
    await runMigrate([tmpDir], { noConfig: true });
    expect(await fs.readFile(file, "utf-8")).toBe(before);
  });

  it("reports an unparseable file without stopping the run", async () => {
    await writeTeam("broken", "key: [unclosed\n");
    await writeTeam("fine", doc("1.0.0", "team-b"));
    expect(await runMigrate([tmpDir], { noConfig: true })).toBe(1);
    expect(printed()).toContain("1 already current");
  });

  it("exits 1 when nothing supplies patterns", async () => {
    expect(await runMigrate([], { noConfig: true })).toBe(1);
  });

  it("exits 1 when no files match", async () => {
    expect(await runMigrate([path.join(tmpDir, "*.yml")], { noConfig: true })).toBe(1);
  });
});

describe("runMigrate --check", () => {
  it("exits 0 on a fully current set", async () => {
    await writeTeam("a", doc("1.0.0", "team-a"));
    expect(await runMigrate([tmpDir], { check: true, noConfig: true })).toBe(0);
  });

  it("exits 1 and writes nothing when a file needs attention", async () => {
    const file = await writeTeam("a", doc("2.0.0", "team-a"));
    const before = await fs.readFile(file, "utf-8");
    expect(await runMigrate([tmpDir], { check: true, noConfig: true })).toBe(1);
    expect(await fs.readFile(file, "utf-8")).toBe(before);
  });
});

/**
 * The half of this that helps people who never run `migrate`: the resolver's own error for a
 * version mismatch used to be `Invalid literal value, expected "1.0.0"`, which reads identically
 * whether the document is ahead of the toolchain or behind it.
 */
describe("validate's version diagnostics", () => {
  it("tells a reader with a future document to upgrade the tool", async () => {
    await writeTeam("a", doc("2.0.0", "team-a"));
    expect(await runValidate([tmpDir], { noConfig: true })).toBe(1);
    expect(printed()).toMatch(/Upgrade @jgalego\/teamapi/);
    expect(printed()).not.toMatch(/Invalid literal value/);
  });

  it("names the missing field when there is no version at all", async () => {
    await writeTeam("a", doc(null, "team-a"));
    await runValidate([tmpDir], { noConfig: true });
    expect(printed()).toMatch(/No teamApiVersion/);
  });

  it("leaves errors that are not about the version alone", async () => {
    // A document at the right version with a real schema error must still get the schema error.
    await writeTeam("a", 'teamApiVersion: "1.0.0"\nid: team-a\ninfo:\n  name: A\n  type: not-a-team-type\n');
    await runValidate([tmpDir], { noConfig: true });
    expect(printed()).toMatch(/info\.type/);
  });
});
