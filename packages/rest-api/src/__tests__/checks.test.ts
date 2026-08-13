import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server";

const ACME = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
const DRIFTWOOD = path.resolve(__dirname, "../../../../examples/driftwood-org/stream-insights/teamapi.yml");

let acme: FastifyInstance;
let driftwood: FastifyInstance;

beforeAll(async () => {
  const acmeStore = new OrgGraphStore({ seedUris: [ACME] });
  await acmeStore.load();
  acme = await buildServer(acmeStore);

  const driftwoodStore = new OrgGraphStore({ seedUris: [DRIFTWOOD] });
  await driftwoodStore.load();
  driftwood = await buildServer(driftwoodStore);
});

describe("GET /policy", () => {
  it("returns the same report the CLI computes", async () => {
    const res = await acme.inject({ method: "GET", url: "/policy" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ satisfied: 1, total: 2 });
  });

  it("reports a rule nothing enforces", async () => {
    const res = await acme.inject({ method: "GET", url: "/policy" });
    const outcomes = res.json().findings.map((f: { outcome: string }) => f.outcome);
    expect(outcomes).toContain("delegated");
  });
});

describe("GET /topology", () => {
  it("returns findings for an org with design smells", async () => {
    const res = await driftwood.inject({ method: "GET", url: "/topology" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.teams).toBe(3);
    expect(body.findings.map((f: { kind: string }) => f.kind)).toContain("collaboration-overrun");
  });

  it("counts every team it checked, not just the ones with findings", async () => {
    const res = await acme.inject({ method: "GET", url: "/topology" });
    expect(res.json().teams).toBe(4);
  });
});

describe("the dashboard's data flow", () => {
  /**
   * The panel reads four endpoints and joins them. The join is where it breaks: `/roles` answers
   * with `{ roles, members }` rather than an array, and agents are absent from the team DTO
   * entirely — both of which fail silently in a browser as an empty section rather than an error.
   */
  it("can determine which roles are vacant from /teams/:id/roles alone", async () => {
    const res = await acme.inject({ method: "GET", url: "/teams/platform-payments/roles" });
    const { roles, members } = res.json();
    expect(Array.isArray(roles)).toBe(true);
    expect(Array.isArray(members)).toBe(true);

    const filled = new Set(members.flatMap((m: { roleIds?: string[] }) => m.roleIds ?? []));
    const vacant = roles.filter((r: { id: string }) => !filled.has(r.id)).map((r: { id: string }) => r.id);
    // The same vacancy `gaps` escalates because two other teams report into it.
    expect(vacant).toEqual(["head-of-engineering"]);
  });

  it("finds agents on /teams/:id/agents, since the team DTO omits them", async () => {
    const fromTeam = await acme.inject({ method: "GET", url: "/teams/platform-payments" });
    expect(fromTeam.json().agents).toBeUndefined();

    const fromAgents = await acme.inject({ method: "GET", url: "/teams/platform-payments/agents" });
    expect(fromAgents.json().length).toBeGreaterThan(0);
  });

  it("serves interactions and dependencies as plain arrays", async () => {
    for (const url of ["/teams/stream-checkout/interactions", "/teams/stream-checkout/dependencies"]) {
      const res = await acme.inject({ method: "GET", url });
      expect(Array.isArray(res.json()), url).toBe(true);
    }
  });
});
