import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFmt } from "../commands/fmt";

const EXAMPLES = path.resolve(__dirname, "../../../../examples");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-fmt-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const SCRAMBLED = `agents: []
teamApiVersion: "1.0.0"
info:
  name: Team A
  type: stream-aligned
id: team-a
`;

async function write(name: string, content: string) {
  const file = path.join(tmpDir, name);
  await fs.writeFile(file, content, "utf-8");
  return file;
}

const printed = () =>
  [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]
    .map((call) => call.map(String).join(" "))
    .join("\n");

describe("runFmt", () => {
  it("rewrites a non-canonical file and exits 0", async () => {
    const file = await write("teamapi.yml", SCRAMBLED);
    expect(await runFmt([file], { noConfig: true })).toBe(0);
    expect(await fs.readFile(file, "utf-8")).toMatch(/^teamApiVersion/);
  });

  it("leaves an already-canonical file byte-identical", async () => {
    const file = await write("teamapi.yml", SCRAMBLED);
    await runFmt([file], { noConfig: true });
    const once = await fs.readFile(file, "utf-8");

    await runFmt([file], { noConfig: true });
    expect(await fs.readFile(file, "utf-8")).toBe(once);
  });

  it("reports how many of how many it changed", async () => {
    const file = await write("teamapi.yml", SCRAMBLED);
    await runFmt([file], { noConfig: true });
    expect(printed()).toContain("Formatted 1 of 1 file(s).");
  });
});

describe("runFmt --check", () => {
  it("exits 1 and writes nothing when a file would change", async () => {
    const file = await write("teamapi.yml", SCRAMBLED);
    expect(await runFmt([file], { check: true, noConfig: true })).toBe(1);
    // The point of --check: the file is untouched.
    expect(await fs.readFile(file, "utf-8")).toBe(SCRAMBLED);
  });

  it("names the files and how to fix them", async () => {
    const file = await write("teamapi.yml", SCRAMBLED);
    await runFmt([file], { check: true, noConfig: true });
    expect(printed()).toContain("teamapi fmt");
  });

  it("exits 0 when everything is already canonical", async () => {
    const file = await write("teamapi.yml", SCRAMBLED);
    await runFmt([file], { noConfig: true });
    expect(await runFmt([file], { check: true, noConfig: true })).toBe(0);
  });
});

describe("runFmt — failures", () => {
  it("reports an unformattable file and leaves it alone", async () => {
    const broken = await write("teamapi.yml", "key: [unclosed\n");
    const original = await fs.readFile(broken, "utf-8");

    expect(await runFmt([broken], { noConfig: true })).toBe(1);
    // Rewriting a file that could not be parsed would destroy it.
    expect(await fs.readFile(broken, "utf-8")).toBe(original);
  });

  it("formats the other files even when one is broken", async () => {
    const broken = await write("a-teamapi.yml", "key: [unclosed\n");
    const good = await write("b-teamapi.yml", SCRAMBLED);

    // One bad document must not stop the other forty.
    expect(await runFmt([broken, good], { noConfig: true })).toBe(1);
    expect(await fs.readFile(good, "utf-8")).toMatch(/^teamApiVersion/);
  });

  it("exits 1 when no files match", async () => {
    expect(await runFmt([path.join(tmpDir, "*.yml")], { noConfig: true })).toBe(1);
  });

  it("exits 1 when nothing supplies patterns", async () => {
    expect(await runFmt([], { noConfig: true })).toBe(1);
  });
});

describe("the bundled examples", () => {
  it("are all in canonical form", async () => {
    // Dogfooding: the repository's own documents have to pass the check it ships.
    expect(await runFmt([EXAMPLES], { check: true, noConfig: true })).toBe(0);
  });
});
