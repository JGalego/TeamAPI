import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { planGaps } from "../gaps/plan";
import { checkPolicies } from "../policy/check";
import { checkTopology } from "../topology/heuristics";
import { orgWideCognitiveLoadReport } from "../cognitive-load/score";
import { deriveContextMap } from "../context-map/derive";
import { deriveKnowledgeGraph } from "../knowledge-graph/derive";
import { buildTopologyDiagram } from "../diagrams/topology";
import { buildOrgHierarchyDiagram } from "../diagrams/org-hierarchy";
import { buildContextMapDiagram } from "../diagrams/context-map";
import { toMermaid } from "../diagrams/mermaid";
import { toDot } from "../diagrams/dot";
import { buildBackstageOrgCatalog, toBackstageYaml } from "../generators/backstage";
import { buildCodeowners } from "../generators/codeowners";
import { buildAgentsMd } from "../generators/agents-md";
import { buildCrewAiOrgConfig } from "../generators/crewai";
import { buildPortCatalog } from "../generators/port";
import { buildOtelPackage } from "../generators/otel";
import { buildPaperclipPackage } from "../generators/paperclip";
import type { OrgGraph } from "../model/org-graph";

const EXAMPLES_ROOT = path.resolve(__dirname, "../../../../examples");

/**
 * Every example org, discovered rather than listed.
 *
 * The listing is the point. Four of the six example orgs shipped for months without a single test
 * touching them, which is exactly the failure mode a hard-coded array reproduces: the next example
 * added to `examples/` would be uncovered again, and nothing would say so. Reading the directory
 * means an example is covered by existing.
 */
function discoverExampleOrgs(): string[] {
  return fs
    .readdirSync(EXAMPLES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Every `teamapi.yml` under an org directory, which is what `teamapi <cmd> examples/<org>` resolves. */
function seedsFor(org: string): string[] {
  const root = path.join(EXAMPLES_ROOT, org);
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, "teamapi.yml"))
    .filter((file) => fs.existsSync(file))
    .sort();
}

const ORGS = discoverExampleOrgs();

// A guard on the guard: if `examples/` were ever moved or emptied, every test below would pass
// vacuously and report a green suite for zero coverage.
describe("examples/", () => {
  it("contains at least the six documented org fixtures", () => {
    expect(ORGS.length).toBeGreaterThanOrEqual(6);
    expect(ORGS).toContain("acme-org");
    expect(ORGS).toContain("driftwood-org");
  });
});

describe.each(ORGS)("examples/%s", (org) => {
  const seeds = seedsFor(org);

  async function resolve(): Promise<OrgGraph> {
    return buildOrgGraph({ seedUris: seeds, allowPartial: true });
  }

  it("has team documents to resolve", () => {
    expect(seeds.length).toBeGreaterThan(0);
  });

  it("resolves with every $ref satisfied", async () => {
    const graph = await resolve();
    // Asserting on the reasons, not just the count: a bare `toHaveLength(0)` on a failure prints
    // "expected 3 to be 0", which says nothing about which reference broke.
    expect(graph.unresolved.map((u) => `${u.fromUri}: ${u.reason}`)).toEqual([]);
  });

  it("resolves one team per document, with no id collisions", async () => {
    const graph = await resolve();
    expect(graph.teams.size).toBe(seeds.length);
    const sourceUris = [...graph.teams.values()].map((team) => team.sourceUri).sort();
    expect(sourceUris).toEqual(seeds);
  });

  it("points every edge at a team that exists", async () => {
    const graph = await resolve();
    for (const edge of graph.edges) {
      expect(graph.teams.has(edge.from)).toBe(true);
      expect(graph.teams.has(edge.to)).toBe(true);
    }
    for (const edge of graph.roleEdges) {
      expect(graph.teams.get(edge.fromTeam)?.doc.roles.some((r) => r.id === edge.fromRole)).toBe(true);
      expect(graph.teams.get(edge.toTeam)?.doc.roles.some((r) => r.id === edge.toRole)).toBe(true);
    }
  });

  it("names a declared role for every member's roleIds", async () => {
    const graph = await resolve();
    for (const team of graph.teams.values()) {
      const roleIds = new Set(team.doc.roles.map((role) => role.id));
      for (const member of team.doc.members) {
        for (const roleId of member.roleIds) {
          expect({ team: team.id, member: member.id, roleId, known: roleIds.has(roleId) }).toMatchObject({
            known: true,
          });
        }
      }
    }
  });

  // Not "every agent has a real owner": driftwood-org exists to demonstrate exactly that hole, so
  // asserting its absence would either fail or force the fixture to stop demonstrating anything.
  // The invariant that holds for every org is the one worth pinning — a dangling `ownerId` is
  // always reported, never silently accepted, because to every downstream consumer it looks
  // identical to a real one.
  it("reports every dangling agent owner as a gap", async () => {
    const graph = await resolve();
    const reported = new Set(
      planGaps(graph)
        .findings.filter((f) => f.kind === "dangling-owner")
        .map((f) => `${f.teamId}/${f.subject ?? ""}`),
    );

    const dangling: string[] = [];
    for (const team of graph.teams.values()) {
      const memberIds = new Set(team.doc.members.map((member) => member.id));
      for (const agent of team.doc.agents) {
        if (agent.ownerId === undefined || memberIds.has(agent.ownerId)) continue;
        dangling.push(`${team.id}/${agent.id}`);
      }
    }

    expect(dangling.filter((key) => !reported.has(key))).toEqual([]);
    // And nothing invented in the other direction: a finding naming an agent whose owner is real
    // would send somebody to fix a document that isn't broken.
    expect([...reported].filter((key) => !dangling.includes(key))).toEqual([]);
  });

  // The graph-only checks. These are what CI runs against acme-org today; the assertion is that
  // they complete and produce well-formed findings on every org, not that they find nothing — an
  // example org whose whole purpose is to demonstrate drift is *supposed* to report findings.
  it("runs gaps, policy and topology to completion", async () => {
    const graph = await resolve();
    const gaps = planGaps(graph);
    const policy = checkPolicies(graph);
    const topology = checkTopology(graph);

    for (const finding of [...gaps.findings, ...policy.findings, ...topology.findings]) {
      expect(finding.severity).toMatch(/^(blocking|warning|info)$/);
      expect(finding.detail.length).toBeGreaterThan(0);
      // Every finding has to name a team that exists, or it is unactionable: the reader's next
      // move after reading one is to open that team's document.
      expect(graph.teams.has(finding.teamId)).toBe(true);
    }
    expect(gaps.matched).toBeGreaterThanOrEqual(0);
    expect(topology.teams).toBe(graph.teams.size);
  });

  it("scores cognitive load for every team that declares it", async () => {
    const graph = await resolve();
    const report = orgWideCognitiveLoadReport(graph);
    const declared = [...graph.teams.values()].filter((team) => team.doc.cognitiveLoad);

    expect(report).toHaveLength(declared.length);
    for (const entry of report) {
      expect(graph.teams.has(entry.teamId)).toBe(true);
      expect(entry.label).toMatch(/^(sustainable|elevated|overloaded)$/);
      expect(Number.isFinite(entry.total)).toBe(true);
    }
    // Sorted heaviest-first, which is what every consumer of it (dashboard, report, MCP tool)
    // relies on rather than re-sorting.
    expect(report.map((entry) => entry.total)).toEqual([...report.map((entry) => entry.total)].sort((a, b) => b - a));
  });

  it("derives a context map and a knowledge graph", async () => {
    const graph = await resolve();

    const contextMap = deriveContextMap(graph);
    for (const relationship of contextMap.relationships) {
      expect(graph.teams.has(relationship.from)).toBe(true);
      expect(graph.teams.has(relationship.to)).toBe(true);
    }

    const knowledge = deriveKnowledgeGraph(graph);
    const nodeIds = new Set(knowledge.nodes.map((node) => node.id));
    // A dangling edge renders as a node the viewer can click and never reach, which is the one
    // knowledge-graph bug a snapshot of acme-org would never catch on another org's shape.
    for (const edge of knowledge.edges) {
      expect({ edge: `${edge.from} -> ${edge.to}`, fromKnown: nodeIds.has(edge.from) }).toMatchObject({
        fromKnown: true,
      });
      expect({ edge: `${edge.from} -> ${edge.to}`, toKnown: nodeIds.has(edge.to) }).toMatchObject({ toKnown: true });
    }
  });

  it("renders every diagram scope as both Mermaid and DOT", async () => {
    const graph = await resolve();
    const models = [
      buildTopologyDiagram(graph),
      buildOrgHierarchyDiagram(graph),
      buildOrgHierarchyDiagram(graph, { withAgents: true }),
      buildContextMapDiagram(graph, deriveContextMap(graph)),
    ];
    for (const model of models) {
      expect(toMermaid(model).trim().length).toBeGreaterThan(0);
      expect(toDot(model).trim().length).toBeGreaterThan(0);
    }
  });

  // `teamapi generate` is the toolchain's widest blast radius — seven targets, each walking the
  // whole graph — and until now every one of them was only ever pointed at acme-org.
  it("runs every generate target", async () => {
    const graph = await resolve();

    const catalog = buildBackstageOrgCatalog(graph);
    expect(catalog.length).toBeGreaterThan(0);
    expect(toBackstageYaml(catalog).length).toBeGreaterThan(0);

    expect(buildCodeowners(graph, { org: org.replace(/-org$/, "") }).files.length).toBeGreaterThan(0);
    expect(buildAgentsMd(graph).files.length).toBeGreaterThan(0);
    expect(buildCrewAiOrgConfig(graph).crews).toHaveLength(graph.teams.size);
    expect(buildPortCatalog(graph).entities.length).toBeGreaterThan(0);
    expect(buildOtelPackage(graph).files.length).toBeGreaterThan(0);
    expect(buildPaperclipPackage(graph, { name: org }).files.length).toBeGreaterThan(0);
  });
});
