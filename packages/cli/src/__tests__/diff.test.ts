import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDiff } from "../commands/diff";

const execFileAsync = promisify(execFile);

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function git(...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: tmpDir });
}

async function writeDoc(extra: Record<string, unknown> = {}): Promise<void> {
  const doc = {
    teamApiVersion: "1.0.0",
    id: "team-a",
    info: { name: "Team A", type: "stream-aligned" },
    ...extra,
  };
  await fs.writeFile(path.join(tmpDir, "teamapi.yml"), JSON.stringify(doc), "utf-8");
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-diff-"));
  await git("init", "-q");
  await git("config", "user.email", "test@test.com");
  await git("config", "user.name", "Test");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("runDiff", () => {
  it("reports no differences when nothing changed since the given ref", async () => {
    await writeDoc();
    await git("add", ".");
    await git("commit", "-q", "-m", "v1");

    const code = await runDiff([tmpDir], { against: "HEAD" });

    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No differences"));
  });

  it("detects role/member/service/cognitive-load changes against a prior commit", async () => {
    await writeDoc({
      roles: [{ id: "lead", name: "Lead", kind: "TechLead" }],
      members: [{ id: "alice", name: "Alice" }],
      services: [{ name: "svc-a" }],
      cognitiveLoad: { intrinsic: 6, extraneous: 8, germane: 4 },
    });
    await git("add", ".");
    await git("commit", "-q", "-m", "v1");

    await writeDoc({
      roles: [
        { id: "lead", name: "Lead", kind: "TechLead" },
        { id: "eng", name: "Engineer", kind: "Engineer" },
      ],
      members: [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
      cognitiveLoad: { intrinsic: 2, extraneous: 2, germane: 2 },
    });

    const code = await runDiff([tmpDir], { against: "HEAD" });

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("cognitive load: 18 (overloaded) -> 6 (sustainable)");
    expect(output).toContain("+ role added: eng");
    expect(output).toContain("+ member added: bob");
    expect(output).toContain("- service removed: svc-a");
  });

  it("diffs against an older commit, not just HEAD", async () => {
    await writeDoc({ roles: [] });
    await git("add", ".");
    await git("commit", "-q", "-m", "v1");
    const { stdout: v1Sha } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: tmpDir });

    await writeDoc({ roles: [{ id: "lead", name: "Lead", kind: "TechLead" }] });
    await git("add", ".");
    await git("commit", "-q", "-m", "v2");

    const code = await runDiff([tmpDir], { against: v1Sha.trim() });

    expect(code).toBe(0);
    const output = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("+ role added: lead");
  });

  it("returns 1 when no files match", async () => {
    const code = await runDiff([path.join(tmpDir, "does-not-exist", "*.yml")], { against: "HEAD" });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No files matched"));
  });

  it("returns 1 outside a git repository", async () => {
    const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-nogit-"));
    try {
      await fs.writeFile(
        path.join(nonGitDir, "teamapi.yml"),
        JSON.stringify({ teamApiVersion: "1.0.0", id: "team-a", info: { name: "Team A", type: "stream-aligned" } }),
        "utf-8",
      );
      const code = await runDiff([nonGitDir], { against: "HEAD" });
      expect(code).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("requires running inside a git repository"));
    } finally {
      await fs.rm(nonGitDir, { recursive: true, force: true });
    }
  });
});
