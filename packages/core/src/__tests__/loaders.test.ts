import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileLoader, HttpLoader, LoaderRegistry } from "../resolve/loaders";

describe("FileLoader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-loader-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves a relative ref against the base file's directory", () => {
    const loader = new FileLoader();
    const base = path.join(tmpDir, "sub", "team-a.yml");
    expect(loader.resolveUri(base, "../team-b.yml")).toBe(path.join(tmpDir, "team-b.yml"));
  });

  it("loads and parses a YAML file", async () => {
    const file = path.join(tmpDir, "team.yml");
    await fs.writeFile(file, "id: team-a\nname: Team A\n", "utf-8");
    const loader = new FileLoader();
    const doc = await loader.load(file);
    expect(doc.canonicalUri).toBe(file);
    expect(doc.raw).toEqual({ id: "team-a", name: "Team A" });
  });
});

describe("HttpLoader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves a relative ref against the base URL", () => {
    const loader = new HttpLoader();
    expect(loader.resolveUri("https://example.com/org/team-a.yml", "../team-b.yml")).toBe(
      "https://example.com/team-b.yml",
    );
  });

  it("fetches and parses a YAML document", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "id: team-a\nname: Team A\n",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new HttpLoader();
    const doc = await loader.load("https://example.com/team-a.yml");
    expect(doc.raw).toEqual({ id: "team-a", name: "Team A" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a descriptive error for a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found", text: async () => "" })),
    );
    const loader = new HttpLoader();
    await expect(loader.load("https://example.com/missing.yml")).rejects.toThrow(/404/);
  });

  it("fetches a given URI at most once, caching concurrent and sequential requests", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "id: team-a\n",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new HttpLoader();
    const uri = "https://example.com/team-a.yml";
    const [first, second] = await Promise.all([loader.load(uri), loader.load(uri)]);
    await loader.load(uri);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("LoaderRegistry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dispatches file:// (plain path) refs to the FileLoader", () => {
    const registry = new LoaderRegistry();
    const resolved = registry.resolveRef("/org/team-a.yml", "../team-b.yml");
    expect(resolved).toBe(path.resolve("/org", "../team-b.yml"));
  });

  it("dispatches https:// refs to the HttpLoader even from a local base", () => {
    const registry = new LoaderRegistry();
    const resolved = registry.resolveRef("/org/team-a.yml", "https://example.com/team-b.yml");
    expect(resolved).toBe("https://example.com/team-b.yml");
  });

  it("loads an https:// uri via fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", text: async () => "id: team-a\n" })),
    );
    const registry = new LoaderRegistry();
    const doc = await registry.load("https://example.com/team-a.yml");
    expect(doc.raw).toEqual({ id: "team-a" });
  });
});
