import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runApply } from "../commands/apply";

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let originalGithubToken: string | undefined;
let originalGhToken: string | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: new Headers({ "content-type": "application/json" }) });
}

// Always written as `teamapi.yml`: `runApply`'s patterns arg is the directory itself, and
// `expandSeeds` only auto-discovers files literally named `teamapi.yml`/`teamapi.yaml` under a
// directory pattern.
async function writeTeam(id: string, githubUsername?: string): Promise<void> {
  await fs.writeFile(
    path.join(tmpDir, "teamapi.yml"),
    JSON.stringify({
      teamApiVersion: "1.0.0",
      id,
      info: { name: id, type: "stream-aligned" },
      members: githubUsername ? [{ id: "member-a", name: "Member A", githubUsername }] : [],
    }),
    "utf-8",
  );
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-apply-"));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  // This sandbox's own GitHub integration may set these ambiently — clear them so every test's
  // token handling is explicit and no test can accidentally reach the real GitHub API.
  originalGithubToken = process.env.GITHUB_TOKEN;
  originalGhToken = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
  if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalGithubToken;
  if (originalGhToken === undefined) delete process.env.GH_TOKEN;
  else process.env.GH_TOKEN = originalGhToken;
});

describe("runApply", () => {
  it("fails fast when no GitHub token is available", async () => {
    await writeTeam("stream-billing");
    const code = await runApply([tmpDir], { org: "acme" });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("GitHub token"));
  });

  it("prints a plan and exits 0 without --yes, making no write calls", async () => {
    await writeTeam("stream-billing", "danielosei");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const code = await runApply([tmpDir], { org: "acme", token: "test-token" });

    expect(code).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("+ create team 'stream-billing' in acme");
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Re-run with --yes to apply this plan.");
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the list-teams read, no writes
  });

  it("executes the plan when --yes is passed", async () => {
    await writeTeam("stream-billing", "danielosei");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([])) // listOrgTeams
      .mockResolvedValueOnce(jsonResponse({ slug: "stream-billing", name: "stream-billing", description: null })) // createTeam
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // setTeamMembership
    vi.stubGlobal("fetch", fetchMock);

    const code = await runApply([tmpDir], { org: "acme", token: "test-token", yes: true });

    expect(code).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Applied.");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports up-to-date orgs without a --yes prompt", async () => {
    await writeTeam("stream-billing", "danielosei");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ slug: "stream-billing", name: "stream-billing", description: null }]))
      .mockResolvedValueOnce(jsonResponse([{ login: "danielosei" }]));
    vi.stubGlobal("fetch", fetchMock);

    const code = await runApply([tmpDir], { org: "acme", token: "test-token" });

    expect(code).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("No changes.");
    expect(logSpy.mock.calls.flat().join("\n")).not.toContain("Re-run with --yes");
  });

  it("returns 1 and surfaces the error when the GitHub API call fails", async () => {
    await writeTeam("stream-billing");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad credentials", { status: 401, statusText: "Unauthorized" })));

    const code = await runApply([tmpDir], { org: "acme", token: "test-token" });

    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
  });
});
