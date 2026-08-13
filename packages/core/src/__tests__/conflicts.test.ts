import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { findNameConflicts, formatNameConflicts } from "../resolve/conflicts";
import { findServiceOwner } from "../model/queries";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-conflicts-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeTeam(id: string, doc: Record<string, unknown> = {}) {
  const file = path.join(tmpDir, `${id}.yml`);
  await fs.writeFile(
    file,
    JSON.stringify({ teamApiVersion: "1.0.0", id, info: { name: id, type: "stream-aligned" }, ...doc }),
    "utf-8",
  );
  return file;
}

/** Two teams linked by an interaction, so one seed resolves both into a single graph. */
async function twoTeams(a: Record<string, unknown>, b: Record<string, unknown>) {
  await writeTeam("team-b", b);
  const first = await writeTeam("team-a", {
    ...a,
    interactions: [{ teamName: "Team B", mode: "x-as-a-service", $ref: "./team-b.yml" }],
  });
  return buildOrgGraph({ seedUris: [first] });
}

describe("findNameConflicts — services", () => {
  it("reports a service name two teams both declare", async () => {
    const graph = await twoTeams({ services: [{ name: "payments-api" }] }, { services: [{ name: "payments-api" }] });
    const conflicts = findNameConflicts(graph);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "duplicate-service",
      name: "payments-api",
      teamIds: ["team-a", "team-b"],
    });
  });

  it("matches case-insensitively, the way findServiceOwner looks names up", async () => {
    const graph = await twoTeams({ services: [{ name: "Payments-API" }] }, { services: [{ name: "payments-api" }] });
    expect(findNameConflicts(graph)).toHaveLength(1);
  });

  it("names every claimant, not just the ones that lose the tie-break", async () => {
    const graph = await twoTeams({ services: [{ name: "shared" }] }, { services: [{ name: "shared" }] });
    // Which team "wins" is an artifact of sorting, so the report has to implicate both.
    expect(findNameConflicts(graph)[0]!.detail).toContain("team-a, team-b");
  });

  it("is silent when service names are distinct", async () => {
    const graph = await twoTeams({ services: [{ name: "checkout-api" }] }, { services: [{ name: "payments-api" }] });
    expect(findNameConflicts(graph)).toEqual([]);
  });

  it("ignores a name repeated within one team, which is that document's own problem", async () => {
    const file = await writeTeam("team-a", { services: [{ name: "dupe" }, { name: "dupe" }] });
    const graph = await buildOrgGraph({ seedUris: [file] });
    expect(findNameConflicts(graph)).toEqual([]);
  });

  /** The behaviour that made this check necessary. */
  it("describes exactly the ambiguity findServiceOwner resolves by sorting", async () => {
    const graph = await twoTeams({ services: [{ name: "payments-api" }] }, { services: [{ name: "payments-api" }] });
    // The query still answers — it has to — and it answers with one of the two claimants.
    expect(findServiceOwner(graph, "payments-api")?.teamId).toBe("team-a");
    // But the org is ambiguous, and that is now sayable.
    expect(findNameConflicts(graph)).toHaveLength(1);
  });
});

describe("findNameConflicts — channels", () => {
  it("reports a channel two teams both claim", async () => {
    const graph = await twoTeams(
      { channels: [{ type: "slack", name: "payments" }] },
      { channels: [{ type: "slack", name: "payments" }] },
    );
    const conflicts = findNameConflicts(graph);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "duplicate-channel", teamIds: ["team-a", "team-b"] });
  });

  it("explains the consequence rather than only stating the fact", async () => {
    const graph = await twoTeams(
      { channels: [{ type: "slack", name: "payments" }] },
      { channels: [{ type: "slack", name: "payments" }] },
    );
    expect(findNameConflicts(graph)[0]!.detail).toContain("slack-sync");
  });

  it("does not conflate the same name on different channel types", async () => {
    // A Slack channel and an email list can share a name without either being ambiguous.
    const graph = await twoTeams(
      { channels: [{ type: "slack", name: "payments" }] },
      { channels: [{ type: "email", name: "payments" }] },
    );
    expect(findNameConflicts(graph)).toEqual([]);
  });
});

describe("formatNameConflicts", () => {
  it("renders one indented line per conflict", async () => {
    const graph = await twoTeams({ services: [{ name: "dupe" }] }, { services: [{ name: "dupe" }] });
    expect(formatNameConflicts(findNameConflicts(graph))).toMatch(/^ {2}- service 'dupe'/);
  });

  it("is empty for no conflicts", () => {
    expect(formatNameConflicts([])).toBe("");
  });
});

describe("the bundled examples", () => {
  it("have no name conflicts", async () => {
    const acme = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
    expect(findNameConflicts(await buildOrgGraph({ seedUris: [acme] }))).toEqual([]);
  });
});
