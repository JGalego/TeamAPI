import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runImport } from "../commands/import";

let tmpDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let originalGithubToken: string | undefined;
let originalGhToken: string | undefined;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: new Headers({ "content-type": "application/json" }) });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-import-"));
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

describe("runImport", () => {
  it("fails fast when no GitHub token is available", async () => {
    const code = await runImport("github-org", "acme", { out: tmpDir });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("GitHub token"));
  });

  it("writes one <team-id>/teamapi.yml per GitHub team", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ slug: "stream-checkout", name: "Stream Checkout", description: "Cart and checkout" }]))
      .mockResolvedValueOnce(jsonResponse([{ login: "diego-alves" }]))
      .mockResolvedValueOnce(jsonResponse([{ name: "checkout-api", html_url: "https://github.com/acme/checkout-api" }]))
      .mockResolvedValueOnce(jsonResponse({ login: "diego-alves", name: "Diego Alves", email: "diego@acme.example" }));
    vi.stubGlobal("fetch", fetchMock);

    const code = await runImport("github-org", "acme", { out: tmpDir, token: "test-token" });

    expect(code).toBe(0);
    const written = YAML.load(await fs.readFile(path.join(tmpDir, "stream-checkout", "teamapi.yml"), "utf-8")) as Record<
      string,
      unknown
    >;
    expect(written).toMatchObject({
      id: "stream-checkout",
      info: { name: "Stream Checkout", focus: "Cart and checkout", type: "stream-aligned" },
      members: [{ id: "diego-alves", name: "Diego Alves", contact: "diego@acme.example", githubUsername: "diego-alves" }],
      services: [{ name: "checkout-api", repository: "https://github.com/acme/checkout-api" }],
    });
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Wrote 1 team(s)");
  });

  it("returns 1 when the org has no teams (or the token lacks access)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
    const code = await runImport("github-org", "acme", { out: tmpDir, token: "test-token" });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("No teams found"));
  });

  it("returns 1 and surfaces the error when the GitHub API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad credentials", { status: 401, statusText: "Unauthorized" })));
    const code = await runImport("github-org", "acme", { out: tmpDir, token: "test-token" });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
  });
});
