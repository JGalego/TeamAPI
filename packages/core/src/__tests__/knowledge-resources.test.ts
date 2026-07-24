import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import {
  getAgent,
  listAgents,
  listAllAgents,
  listPrompts,
  MissingPromptVariableError,
  renderPrompt,
  resolveEffectiveSteering,
} from "../model/knowledge-resources";
import type { OrgGraph } from "../model/org-graph";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let graph: OrgGraph;

beforeAll(async () => {
  graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
});

describe("agents", () => {
  it("lists agents declared on a team, sorted by id", () => {
    expect(listAgents(graph, "platform-payments").map((a) => a.id)).toEqual([
      "architecture-reviewer",
      "compliance-auditor",
      "docs-writer",
      "security-scanner",
      "test-generator",
    ]);
  });

  it("returns an empty array for a team with no agents", () => {
    expect(listAgents(graph, "stream-checkout")).toEqual([]);
  });

  it("returns an empty array for a team deliberately kept agent-free", () => {
    expect(listAgents(graph, "stream-onboarding")).toEqual([]);
  });

  it("gets a single agent by id", () => {
    expect(getAgent(graph, "platform-payments", "architecture-reviewer")?.provider).toBe("OpenAI");
  });

  it("returns undefined for an unknown agent id", () => {
    expect(getAgent(graph, "platform-payments", "does-not-exist")).toBeUndefined();
  });

  it("lists all agents across the org, optionally filtered by search", () => {
    const all = listAllAgents(graph);
    expect(all.map((e) => e.item.id)).toContain("architecture-reviewer");
    expect(listAllAgents(graph, "reviewer")).toHaveLength(1);
    expect(listAllAgents(graph, "zzz-no-match")).toHaveLength(0);
  });
});

describe("resolveEffectiveSteering", () => {
  it("inherits organization-scoped steering documents via the platform edge chain", () => {
    const effective = resolveEffectiveSteering(graph, "stream-checkout");
    const ids = effective.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining(["security-guidelines", "api-conventions"]));
  });

  it("returns a team's own documents directly, without inheritance, for the declaring team itself", () => {
    const effective = resolveEffectiveSteering(graph, "platform-payments");
    expect(effective.map((d) => d.id)).toEqual(["api-conventions", "security-guidelines"]);
  });

  it("returns an empty array for a team with no steering documents anywhere in its platform chain", () => {
    expect(resolveEffectiveSteering(graph, "enabling-devex")).toEqual([]);
  });
});

describe("renderPrompt", () => {
  it("fills a required variable from the supplied value", () => {
    const prompt = getAgentPrompt();
    expect(renderPrompt(prompt, { repository: "checkout-api" })).toContain("checkout-api");
  });

  it("throws MissingPromptVariableError for a required variable with no value or default", () => {
    const prompt = getAgentPrompt();
    expect(() => renderPrompt(prompt)).toThrow(MissingPromptVariableError);
  });

  it("falls back to a variable's default when no value is supplied", () => {
    const prompt = {
      id: "greeting",
      name: "Greeting",
      template: "Hello, {{name}}!",
      variables: [{ name: "name", required: false, default: "world" }],
      version: "1.0.0",
      versions: [],
      tags: [],
    };
    expect(renderPrompt(prompt)).toBe("Hello, world!");
  });
});

function getAgentPrompt() {
  const prompt = listPrompts(graph, "platform-payments").find((p) => p.id === "code-review");
  if (!prompt) throw new Error("fixture prompt 'code-review' not found");
  return prompt;
}
