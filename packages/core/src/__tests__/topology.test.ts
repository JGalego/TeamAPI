import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import {
  checkTopology,
  DEFAULT_TOPOLOGY_CONFIG,
  expectedEnd,
  formatTopology,
  hasBlockingTopologyFindings,
  isTopologyKind,
  type TopologyKind,
} from "../topology/heuristics";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-topology-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const NOW = new Date("2026-06-15T00:00:00Z");

async function writeTeam(id: string, doc: Record<string, unknown> = {}) {
  const file = path.join(tmpDir, `${id}.yml`);
  await fs.writeFile(
    file,
    JSON.stringify({
      teamApiVersion: "1.0.0",
      id,
      info: { name: id, type: "stream-aligned" },
      ...doc,
    }),
    "utf-8",
  );
  return file;
}

const kinds = (findings: { kind: TopologyKind }[]) => findings.map((f) => f.kind);

describe("expectedEnd", () => {
  it("adds days", () => {
    expect(
      expectedEnd({
        $ref: "x",
        teamName: "T",
        mode: "collaboration",
        startDate: "2026-01-01",
        expectedDuration: 10,
        expectedDurationUnit: "days",
      })
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2026-01-11");
  });

  it("adds weeks", () => {
    expect(
      expectedEnd({
        $ref: "x",
        teamName: "T",
        mode: "collaboration",
        startDate: "2026-01-01",
        expectedDuration: 2,
        expectedDurationUnit: "weeks",
      })
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2026-01-15");
  });

  it("defaults a missing unit to days", () => {
    expect(
      expectedEnd({ $ref: "x", teamName: "T", mode: "collaboration", startDate: "2026-01-01", expectedDuration: 5 })
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2026-01-06");
  });

  it("is undefined without a start date or a duration", () => {
    expect(expectedEnd({ $ref: "x", teamName: "T", mode: "collaboration", expectedDuration: 5 })).toBeUndefined();
    expect(expectedEnd({ $ref: "x", teamName: "T", mode: "collaboration", startDate: "2026-01-01" })).toBeUndefined();
  });

  it("is undefined for an unparseable start date rather than producing an Invalid Date", () => {
    expect(
      expectedEnd({ $ref: "x", teamName: "T", mode: "collaboration", startDate: "last spring", expectedDuration: 5 }),
    ).toBeUndefined();
  });
});

describe("checkTopology — collaborations", () => {
  it("reports a collaboration past its declared end", async () => {
    const other = await writeTeam("team-b");
    const file = await writeTeam("team-a", {
      interactions: [
        {
          teamName: "Team B",
          mode: "collaboration",
          $ref: `./${path.basename(other)}`,
          startDate: "2026-01-01",
          expectedDuration: 4,
          expectedDurationUnit: "weeks",
        },
      ],
    });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(kinds(report.findings)).toEqual(["collaboration-overrun"]);
    expect(report.findings[0]!.detail).toContain("2026-01-29");
  });

  it("says nothing about a collaboration still inside its window", async () => {
    const other = await writeTeam("team-b");
    const file = await writeTeam("team-a", {
      interactions: [
        {
          teamName: "Team B",
          mode: "collaboration",
          $ref: `./${path.basename(other)}`,
          startDate: "2026-06-01",
          expectedDuration: 3,
          expectedDurationUnit: "months",
        },
      ],
    });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(report.findings).toEqual([]);
  });

  it("reports a collaboration that never said when it should end", async () => {
    const other = await writeTeam("team-b");
    const file = await writeTeam("team-a", {
      interactions: [{ teamName: "Team B", mode: "collaboration", $ref: `./${path.basename(other)}` }],
    });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(kinds(report.findings)).toEqual(["collaboration-untimed"]);
  });

  it("leaves x-as-a-service and facilitating alone, which are not time-boxed by nature", async () => {
    const b = await writeTeam("team-b");
    const c = await writeTeam("team-c");
    const file = await writeTeam("team-a", {
      interactions: [
        { teamName: "Team B", mode: "x-as-a-service", $ref: `./${path.basename(b)}` },
        { teamName: "Team C", mode: "facilitating", $ref: `./${path.basename(c)}` },
      ],
    });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(report.findings).toEqual([]);
  });

  it("reports a team in more concurrent collaborations than the limit", async () => {
    const targets = await Promise.all(["b", "c", "d", "e"].map((id) => writeTeam(`team-${id}`)));
    const file = await writeTeam("team-a", {
      interactions: targets.map((target, index) => ({
        teamName: `Team ${index}`,
        mode: "collaboration",
        $ref: `./${path.basename(target)}`,
        startDate: "2026-06-01",
        expectedDuration: 6,
        expectedDurationUnit: "months",
      })),
    });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(kinds(report.findings)).toContain("collaboration-overload");
  });
});

describe("checkTopology — team size", () => {
  const members = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `member-${index}`, name: `Member ${index}` }));

  it("reports a team above the limit", async () => {
    const file = await writeTeam("team-a", { members: members(10) });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(kinds(report.findings)).toEqual(["team-too-large"]);
  });

  it("says nothing at exactly the limit", async () => {
    const file = await writeTeam("team-a", { members: members(9) });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(report.findings).toEqual([]);
  });

  it("honours a configured limit", async () => {
    const file = await writeTeam("team-a", { members: members(6) });
    const report = checkTopology(
      await buildOrgGraph({ seedUris: [file] }),
      { ...DEFAULT_TOPOLOGY_CONFIG, maxTeamSize: 5 },
      NOW,
    );
    expect(kinds(report.findings)).toEqual(["team-too-large"]);
  });
});

describe("checkTopology — flow", () => {
  it("reports a platform team depending on a stream-aligned team", async () => {
    const stream = await writeTeam("stream-a");
    const file = path.join(tmpDir, "platform.yml");
    await fs.writeFile(
      file,
      JSON.stringify({
        teamApiVersion: "1.0.0",
        id: "platform-a",
        info: { name: "Platform A", type: "platform" },
        dependencies: [{ teamName: "Stream A", type: "OK", $ref: `./${path.basename(stream)}` }],
      }),
      "utf-8",
    );
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(kinds(report.findings)).toContain("platform-depends-on-stream");
  });

  it("says nothing when a stream-aligned team depends on a platform, which is the intended flow", async () => {
    const platformFile = path.join(tmpDir, "platform.yml");
    await fs.writeFile(
      platformFile,
      JSON.stringify({ teamApiVersion: "1.0.0", id: "platform-a", info: { name: "Platform A", type: "platform" } }),
      "utf-8",
    );
    const file = await writeTeam("stream-a", {
      dependencies: [{ teamName: "Platform A", type: "OK", $ref: "./platform.yml" }],
    });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(report.findings).toEqual([]);
  });

  it("reports a dependency the team itself called blocking", async () => {
    const other = await writeTeam("team-b");
    const file = await writeTeam("team-a", {
      dependencies: [{ teamName: "Team B", type: "Blocking", $ref: `./${path.basename(other)}` }],
    });
    const report = checkTopology(await buildOrgGraph({ seedUris: [file] }), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(kinds(report.findings)).toEqual(["blocking-dependency"]);
  });
});

describe("checkTopology — severity overrides", () => {
  const oversized = async () =>
    buildOrgGraph({
      seedUris: [
        await writeTeam("team-a", {
          members: Array.from({ length: 12 }, (_, i) => ({ id: `m-${i}`, name: `M${i}` })),
        }),
      ],
    });

  it("warns by default, so nothing here fails a build unasked", async () => {
    const report = checkTopology(await oversized(), DEFAULT_TOPOLOGY_CONFIG, NOW);
    expect(report.findings[0]!.severity).toBe("warning");
    expect(hasBlockingTopologyFindings(report)).toBe(false);
  });

  it("can be made a gate", async () => {
    const report = checkTopology(
      await oversized(),
      { ...DEFAULT_TOPOLOGY_CONFIG, severity: { "team-too-large": "blocking" } },
      NOW,
    );
    expect(hasBlockingTopologyFindings(report)).toBe(true);
  });

  it("can be turned off", async () => {
    const report = checkTopology(
      await oversized(),
      { ...DEFAULT_TOPOLOGY_CONFIG, severity: { "team-too-large": "off" } },
      NOW,
    );
    expect(report.findings).toEqual([]);
  });
});

describe("formatTopology", () => {
  it("says what it checked when there is nothing to report", async () => {
    const report = checkTopology(
      await buildOrgGraph({ seedUris: [await writeTeam("team-a")] }),
      DEFAULT_TOPOLOGY_CONFIG,
      NOW,
    );
    expect(formatTopology(report)).toBe("No topology smells. 1 team(s) checked.");
  });
});

describe("isTopologyKind", () => {
  it("accepts every kind the checker emits", () => {
    for (const kind of [
      "collaboration-overrun",
      "collaboration-untimed",
      "team-too-large",
      "collaboration-overload",
      "platform-depends-on-stream",
      "blocking-dependency",
    ]) {
      expect(isTopologyKind(kind), kind).toBe(true);
    }
  });

  it("rejects a typo", () => {
    expect(isTopologyKind("team-too-big")).toBe(false);
  });
});
