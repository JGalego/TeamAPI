import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-cycle-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeTeam(id: string, extra: Record<string, unknown> = {}) {
  const file = path.join(tmpDir, `${id}.yml`);
  const doc = {
    teamApiVersion: "1.0.0",
    id,
    info: { name: id, type: "stream-aligned" },
    ...extra,
  };
  await fs.writeFile(file, JSON.stringify(doc), "utf-8");
  return file;
}

describe("buildOrgGraph — cycles", () => {
  it("resolves a mutual A<->B reference without infinite looping, fetching each doc once", async () => {
    const aFile = await writeTeam("team-a", {
      interactions: [{ teamName: "team-b", mode: "collaboration", $ref: "./team-b.yml" }],
    });
    await writeTeam("team-b", {
      interactions: [{ teamName: "team-a", mode: "collaboration", $ref: "./team-a.yml" }],
    });

    const graph = await buildOrgGraph({ seedUris: [aFile] });

    expect(graph.teams.size).toBe(2);
    expect(graph.unresolved).toEqual([]);
    // one interaction edge declared on each side => 2 edges total, not an infinite chain
    expect(graph.edges.filter((e) => e.kind === "interaction")).toHaveLength(2);
  });

  it("handles a 3-node cycle A->B->C->A", async () => {
    await writeTeam("team-a", {
      dependencies: [{ teamName: "team-b", type: "OK", $ref: "./team-b.yml" }],
    });
    await writeTeam("team-b", {
      dependencies: [{ teamName: "team-c", type: "OK", $ref: "./team-c.yml" }],
    });
    const cFile = await writeTeam("team-c", {
      dependencies: [{ teamName: "team-a", type: "OK", $ref: "./team-a.yml" }],
    });

    const graph = await buildOrgGraph({ seedUris: [cFile] });

    expect(graph.teams.size).toBe(3);
    expect(graph.edges.filter((e) => e.kind === "dependency")).toHaveLength(3);
  });

  it("collects an unresolvable ref instead of throwing when allowPartial is set", async () => {
    const aFile = await writeTeam("team-a", {
      dependencies: [{ teamName: "ghost", type: "OK", $ref: "./does-not-exist.yml" }],
    });

    const graph = await buildOrgGraph({ seedUris: [aFile], allowPartial: true });

    expect(graph.teams.size).toBe(1);
    expect(graph.unresolved.length).toBeGreaterThan(0);
    expect(graph.edges).toEqual([]);
  });

  it("throws on an unresolvable ref in strict mode (default)", async () => {
    const aFile = await writeTeam("team-a", {
      dependencies: [{ teamName: "ghost", type: "OK", $ref: "./does-not-exist.yml" }],
    });

    await expect(buildOrgGraph({ seedUris: [aFile] })).rejects.toThrow();
  });

  it("flags duplicate team ids declared from different files", async () => {
    const aFile = await writeTeam("team-a", {
      dependencies: [{ teamName: "dup", type: "OK", $ref: "./dup-of-a.yml" }],
    });
    const dupFile = path.join(tmpDir, "dup-of-a.yml");
    await fs.writeFile(
      dupFile,
      JSON.stringify({ teamApiVersion: "1.0.0", id: "team-a", info: { name: "Duplicate", type: "stream-aligned" } }),
      "utf-8",
    );

    const graph = await buildOrgGraph({ seedUris: [aFile], allowPartial: true });
    expect(graph.unresolved.some((u) => u.reason.includes("Duplicate team id"))).toBe(true);
  });
});
