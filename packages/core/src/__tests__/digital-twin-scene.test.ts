import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildDigitalTwinScene } from "../digital-twin/live-scene";
import type { OrgGraph } from "../model/org-graph";
import { buildOrgGraph } from "../resolve/graph-builder";

const SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [SEED] });
});

describe("live digital twin scene", () => {
  it("turns the resolved graph into a stable replay model", () => {
    const first = buildDigitalTwinScene(graph);
    const second = buildDigitalTwinScene(graph);
    expect(first).toEqual(second);
    expect(first.teams).toHaveLength(graph.teams.size);
    expect(first.links).toHaveLength(graph.edges.length);
    expect(first.events.length).toBeGreaterThan(0);
  });

  it("includes human and agent actors with team attribution", () => {
    const scene = buildDigitalTwinScene(graph);
    expect(scene.actors.some((actor) => actor.kind === "human")).toBe(true);
    expect(scene.actors.some((actor) => actor.kind === "agent")).toBe(true);
    expect(scene.actors.every((actor) => graph.teams.has(actor.teamId))).toBe(true);
  });

  it("labels every relationship for animation without claiming execution", () => {
    const scene = buildDigitalTwinScene(graph);
    expect(scene.links.every((link) => link.label.length > 0)).toBe(true);
    expect(scene.events.filter((event) => event.targetTeamId)).toHaveLength(graph.edges.length);
  });

  it("emits a heartbeat for an otherwise quiet graph", () => {
    const quiet: OrgGraph = {
      teams: new Map([
        [
          "quiet",
          {
            ...graph.teams.values().next().value!,
            id: "quiet",
            doc: { ...graph.teams.values().next().value!.doc, id: "quiet", members: [], agents: [], services: [] },
          },
        ],
      ]),
      edges: [],
      roleEdges: [],
      unresolved: [],
      meta: { resolvedAt: "2026-08-26T00:00:00.000Z", sourceRoots: [] },
    };
    expect(buildDigitalTwinScene(quiet).events).toEqual([
      { id: "heartbeat:quiet", kind: "heartbeat", teamId: "quiet", label: "Graph loaded" },
    ]);
  });
});
