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
