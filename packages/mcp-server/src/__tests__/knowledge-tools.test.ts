import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@jgalego/teamapi-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let client: Client;

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? "";
}

beforeAll(async () => {
  const store = new OrgGraphStore({ seedUris: [CHECKOUT_SEED] });
  await store.load();
  const server = createMcpServer(store);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

describe("AI-native knowledge tools", () => {
  it("registers the expected tool names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_agents",
        "get_agent",
        "list_specifications",
        "get_specification",
        "list_steering_documents",
        "get_steering_document",
        "list_prompts",
        "get_prompt",
        "render_prompt",
        "list_playbooks",
        "get_playbook",
        "list_policies",
        "get_policy",
        "list_knowledge_base_entries",
        "get_knowledge_base_entry",
        "list_workflows",
        "get_workflow",
        "list_ai_sessions",
        "get_ai_session",
        "get_context_bundle",
        "get_knowledge_graph",
        "traverse_knowledge_graph",
      ]),
    );
  });

  it("list_agents scoped to a team returns that team's agents", async () => {
    const result = await client.callTool({ name: "list_agents", arguments: { teamId: "platform-payments" } });
    const agents = JSON.parse(textOf(result));
    expect(agents.map((a: { id: string }) => a.id)).toEqual(["architecture-reviewer"]);
  });

  it("list_agents without teamId returns an org-wide list", async () => {
    const result = await client.callTool({ name: "list_agents", arguments: {} });
    const agents = JSON.parse(textOf(result));
    expect(agents.some((e: { item: { id: string } }) => e.item.id === "architecture-reviewer")).toBe(true);
  });

  it("get_agent returns an error result for an unknown team", async () => {
    const result = await client.callTool({ name: "get_agent", arguments: { teamId: "does-not-exist", resourceId: "x" } });
    expect(result.isError).toBe(true);
  });

  it("list_steering_documents with effective=true inherits organization-scoped documents", async () => {
    const result = await client.callTool({
      name: "list_steering_documents",
      arguments: { teamId: "stream-checkout", effective: true },
    });
    const docs = JSON.parse(textOf(result));
    expect(docs.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining(["security-guidelines", "api-conventions"]));
  });

  it("render_prompt fills a required variable", async () => {
    const result = await client.callTool({
      name: "render_prompt",
      arguments: { teamId: "platform-payments", promptId: "code-review", variables: { repository: "checkout-api" } },
    });
    const body = JSON.parse(textOf(result));
    expect(body.rendered).toContain("checkout-api");
  });

  it("render_prompt returns an error result when a required variable is missing", async () => {
    const result = await client.callTool({
      name: "render_prompt",
      arguments: { teamId: "platform-payments", promptId: "code-review" },
    });
    expect(result.isError).toBe(true);
  });

  it("get_context_bundle assembles a bundle for a goal", async () => {
    const result = await client.callTool({
      name: "get_context_bundle",
      arguments: { goal: "Implement OAuth login", teamId: "stream-checkout" },
    });
    const bundle = JSON.parse(textOf(result));
    expect(bundle.specifications.some((s: { item: { id: string } }) => s.item.id === "oauth-login-support")).toBe(true);
  });

  it("get_knowledge_graph returns nodes and edges", async () => {
    const result = await client.callTool({ name: "get_knowledge_graph", arguments: {} });
    const graph = JSON.parse(textOf(result));
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it("traverse_knowledge_graph returns an error result for an unknown node", async () => {
    const result = await client.callTool({ name: "traverse_knowledge_graph", arguments: { nodeId: "does-not-exist" } });
    expect(result.isError).toBe(true);
  });
});
