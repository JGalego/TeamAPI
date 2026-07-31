import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { deriveKnowledgeGraph, traverseKnowledgeGraph } from "../knowledge-graph/derive";
import type { OrgGraph } from "../model/org-graph";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
});

describe("deriveKnowledgeGraph", () => {
  it("adds an 'owns' edge from each team to every AI-native resource it declares", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.edges).toContainEqual({
      from: "team:platform-payments",
      to: "agent:platform-payments:architecture-reviewer",
      relation: "owns",
    });
    expect(kg.nodes.find((n) => n.id === "agent:platform-payments:architecture-reviewer")?.label).toBe(
      "Architecture Reviewer",
    );
  });

  it("links a session to the agent that ran it and the prompts it used", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.edges).toContainEqual({
      from: "session:platform-payments:2026-07-01-oauth-spike",
      to: "agent:platform-payments:architecture-reviewer",
      relation: "ranBy",
    });
    expect(kg.edges).toContainEqual({
      from: "session:platform-payments:2026-07-01-oauth-spike",
      to: "prompt:platform-payments:code-review",
      relation: "usedPrompt",
    });
  });

  it("owns one node per agent in a full multi-agent fleet, each ranBy a different session", () => {
    const kg = deriveKnowledgeGraph(graph);
    const fleet = ["architecture-reviewer", "test-generator", "security-scanner", "docs-writer", "compliance-auditor"];
    for (const agentId of fleet) {
      expect(kg.nodes.some((n) => n.id === `agent:platform-payments:${agentId}`)).toBe(true);
    }
    // Two of the fleet reviewed the same OAuth PR in parallel, from different angles (tests vs. security).
    expect(kg.edges).toContainEqual({
      from: "session:platform-payments:2026-07-02-oauth-test-coverage",
      to: "agent:platform-payments:test-generator",
      relation: "ranBy",
    });
    expect(kg.edges).toContainEqual({
      from: "session:platform-payments:2026-07-02-oauth-security-scan",
      to: "agent:platform-payments:security-scanner",
      relation: "ranBy",
    });
  });

  it("owns no agent nodes for a team deliberately kept agent-free", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.nodes.some((n) => n.kind === "agent" && n.teamId === "stream-onboarding")).toBe(false);
    expect(
      kg.edges.some((e) => e.from === "team:stream-onboarding" && e.relation === "owns" && e.to.startsWith("agent:")),
    ).toBe(false);
  });

  it("resolves a specification's linkedDocuments $ref to a cross-team 'references' edge", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.edges).toContainEqual({
      from: "specification:stream-checkout:oauth-login-support",
      to: "team:platform-payments",
      relation: "references",
    });
  });

  it("includes existing team-level and role-level edges from the org graph", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.edges.some((e) => e.relation === "platform" && e.from === "team:stream-checkout")).toBe(true);
    expect(kg.edges.some((e) => e.relation === "reportsTo")).toBe(true);
  });

  it("links members to the roles they fill", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.edges).toContainEqual({
      from: "member:stream-checkout:diego-alves",
      to: "role:stream-checkout:tech-lead",
      relation: "fills",
    });
  });

  it("links each agent to the human accountable for it", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.edges).toContainEqual({
      from: "member:platform-payments:sam-okafor",
      to: "agent:platform-payments:test-generator",
      relation: "accountableFor",
    });
  });

  it("draws no accountability edge for an agent whose ownerId names nobody", async () => {
    const driftwood = await buildOrgGraph({
      seedUris: [path.resolve(__dirname, "../../../../examples/driftwood-org/platform-data/teamapi.yml")],
    });
    const kg = deriveKnowledgeGraph(driftwood);
    // `pipeline-reviewer` is owned by someone who left — `teamapi gaps` blocks on it, and drawing
    // an edge to a person who isn't there would launder exactly that false impression.
    expect(kg.nodes.some((n) => n.id === "agent:platform-data:pipeline-reviewer")).toBe(true);
    // Still owned by its team, just accountable to nobody.
    expect(kg.edges).toContainEqual({
      from: "team:platform-data",
      to: "agent:platform-data:pipeline-reviewer",
      relation: "owns",
    });
    expect(
      kg.edges.some((e) => e.relation === "accountableFor" && e.to === "agent:platform-data:pipeline-reviewer"),
    ).toBe(false);
    expect(kg.edges).toContainEqual({
      from: "member:platform-data:rowan-esposito",
      to: "agent:platform-data:backfill-runner",
      relation: "accountableFor",
    });
  });

  it("maps the informal role-edge kinds into their own relations", async () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(kg.edges).toContainEqual({
      from: "role:stream-checkout:tech-lead",
      to: "role:enabling-devex:coach",
      relation: "learnsFrom",
    });
  });
});

describe("traverseKnowledgeGraph", () => {
  it("returns just the starting node at depth 0 reach (no hops taken)", () => {
    const kg = deriveKnowledgeGraph(graph);
    const sub = traverseKnowledgeGraph(kg, "team:stream-checkout", 0);
    expect(sub.nodes.map((n) => n.id)).toEqual(["team:stream-checkout"]);
    expect(sub.edges).toEqual([]);
  });

  it("expands outward with more hops", () => {
    const kg = deriveKnowledgeGraph(graph);
    const oneHop = traverseKnowledgeGraph(kg, "team:stream-checkout", 1);
    const twoHops = traverseKnowledgeGraph(kg, "team:stream-checkout", 2);
    expect(twoHops.nodes.length).toBeGreaterThanOrEqual(oneHop.nodes.length);
  });

  it("returns an empty subgraph for an unknown node id", () => {
    const kg = deriveKnowledgeGraph(graph);
    expect(traverseKnowledgeGraph(kg, "does-not-exist", 2)).toEqual({ nodes: [], edges: [] });
  });
});
