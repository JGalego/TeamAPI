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
  it("names the variables to set when the source needs a token and has none", async () => {
    const code = await runImport("github-org", "acme", { out: tmpDir });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("GITHUB_TOKEN/GH_TOKEN"));
  });

  it.each([
    ["backstage", "/does/not/exist.yaml"],
    ["csv", "/does/not/exist.csv"],
  ] as const)("reports a missing %s input rather than throwing out of the command", async (source, argument) => {
    // Every source funnels through one error path, so a new one cannot accidentally crash the
    // process instead of exiting 1 with a message.
    expect(await runImport(source, argument, { out: tmpDir })).toBe(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("imports a Backstage catalog from a file", async () => {
    const catalog = path.join(tmpDir, "catalog-info.yaml");
    await fs.writeFile(
      catalog,
      [
        "kind: Group",
        "metadata:",
        "  name: payments",
        "spec:",
        "  type: platform",
        "---",
        "kind: User",
        "metadata:",
        "  name: aoife",
        "spec:",
        "  memberOf: [group:default/payments]",
      ].join("\n"),
      "utf-8",
    );

    expect(await runImport("backstage", catalog, { out: path.join(tmpDir, "out") })).toBe(0);
    const written = YAML.load(
      await fs.readFile(path.join(tmpDir, "out", "payments", "teamapi.yml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(written.info).toMatchObject({ type: "platform" });
    expect(written.members).toHaveLength(1);
  });

  it("imports a CSV roster, naming what it could not know", async () => {
    const csv = path.join(tmpDir, "roster.csv");
    await fs.writeFile(csv, "Name,Email,Department,Job Title\nAoife,a@x.com,Payments,Tech Lead\n", "utf-8");

    expect(await runImport("csv", csv, { out: path.join(tmpDir, "out") })).toBe(0);
    const written = YAML.load(await fs.readFile(path.join(tmpDir, "out", "payments", "teamapi.yml"), "utf-8")) as {
      roles: Array<{ id: string }>;
    };
    expect(written.roles.map((role) => role.id)).toEqual(["tech-lead"]);
    // The caveat matters as much as the output: nobody should ship an import believing it is done.
    expect(logSpy.mock.calls.some((args) => String(args[0]).includes("job-title column"))).toBe(true);
  });

  it("writes one <team-id>/teamapi.yml per GitHub team", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ slug: "stream-checkout", name: "Stream Checkout", description: "Cart and checkout" }]),
      )
      .mockResolvedValueOnce(jsonResponse([{ login: "diego-alves" }]))
      .mockResolvedValueOnce(jsonResponse([{ name: "checkout-api", html_url: "https://github.com/acme/checkout-api" }]))
      .mockResolvedValueOnce(jsonResponse({ login: "diego-alves", name: "Diego Alves", email: "diego@acme.example" }));
    vi.stubGlobal("fetch", fetchMock);

    const code = await runImport("github-org", "acme", { out: tmpDir, token: "test-token" });

    expect(code).toBe(0);
    const written = YAML.load(
      await fs.readFile(path.join(tmpDir, "stream-checkout", "teamapi.yml"), "utf-8"),
    ) as Record<string, unknown>;
    expect(written).toMatchObject({
      id: "stream-checkout",
      info: { name: "Stream Checkout", focus: "Cart and checkout", type: "stream-aligned" },
      members: [
        { id: "diego-alves", name: "Diego Alves", contact: "diego@acme.example", githubUsername: "diego-alves" },
      ],
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("bad credentials", { status: 401, statusText: "Unauthorized" })),
    );
    const code = await runImport("github-org", "acme", { out: tmpDir, token: "test-token" });
    expect(code).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("401"));
  });
});
