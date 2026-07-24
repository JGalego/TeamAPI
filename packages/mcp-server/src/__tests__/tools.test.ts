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

describe("MCP tools", () => {
  it("lists registered tools including the expected names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_teams",
        "get_team",
        "get_team_roles",
        "get_team_cognitive_load",
        "find_service_owner",
        "list_services",
        "get_team_interactions",
        "get_team_dependencies",
        "get_context_map",
        "render_org_diagram",
        "search_org",
        "get_org_graph",
        "get_org_cognitive_load_report",
      ]),
    );
  });

  it("list_teams returns all four teams", async () => {
    const result = await client.callTool({ name: "list_teams", arguments: {} });
    const teams = JSON.parse(textOf(result));
    expect(teams.map((t: { id: string }) => t.id).sort()).toEqual([
      "enabling-devex",
      "platform-payments",
      "stream-checkout",
      "stream-onboarding",
    ]);
  });

  it("get_team returns an error result for an unknown team", async () => {
    const result = await client.callTool({ name: "get_team", arguments: { teamId: "does-not-exist" } });
    expect(result.isError).toBe(true);
  });

  it("get_team_roles returns roles and members for a team", async () => {
    const result = await client.callTool({ name: "get_team_roles", arguments: { teamId: "stream-checkout" } });
    const body = JSON.parse(textOf(result));
    expect(body.roles.map((r: { id: string }) => r.id).sort()).toEqual([
      "backend-engineer",
      "frontend-engineer",
      "tech-lead",
    ]);
    expect(body.members.length).toBeGreaterThan(0);
  });

  it("get_team_roles returns an error result for an unknown team", async () => {
    const result = await client.callTool({ name: "get_team_roles", arguments: { teamId: "does-not-exist" } });
    expect(result.isError).toBe(true);
  });

  it("get_team_cognitive_load returns a team's score", async () => {
    const result = await client.callTool({
      name: "get_team_cognitive_load",
      arguments: { teamId: "stream-checkout" },
    });
    const body = JSON.parse(textOf(result));
    expect(body).toMatchObject({ teamId: "stream-checkout", label: "overloaded" });
  });

  it("get_team_cognitive_load returns an error result for a team with no assessment", async () => {
    const result = await client.callTool({
      name: "get_team_cognitive_load",
      arguments: { teamId: "enabling-devex" },
    });
    expect(result.isError).toBe(true);
  });

  it("find_service_owner finds the owning team", async () => {
    const result = await client.callTool({ name: "find_service_owner", arguments: { serviceName: "ledger" } });
    const body = JSON.parse(textOf(result));
    expect(body.teamId).toBe("platform-payments");
  });

  it("find_service_owner returns an error result for an unknown service", async () => {
    const result = await client.callTool({ name: "find_service_owner", arguments: { serviceName: "does-not-exist" } });
    expect(result.isError).toBe(true);
  });

  it("find_service_owner requires an exact match (substrings don't match)", async () => {
    const result = await client.callTool({ name: "find_service_owner", arguments: { serviceName: "checkout" } });
    expect(result.isError).toBe(true);
  });

  it("list_services lists every service across the org", async () => {
    const result = await client.callTool({ name: "list_services", arguments: {} });
    const body = JSON.parse(textOf(result));
    expect(body.some((s: { service: { name: string } }) => s.service.name === "checkout-api")).toBe(true);
  });

  it("list_services filters by a search term", async () => {
    const result = await client.callTool({ name: "list_services", arguments: { search: "ledger" } });
    const body = JSON.parse(textOf(result));
    expect(body).toHaveLength(1);
    expect(body[0].service.name).toBe("ledger");
  });

  it("get_team_interactions returns a team's interactions", async () => {
    const result = await client.callTool({
      name: "get_team_interactions",
      arguments: { teamId: "stream-checkout" },
    });
    const body = JSON.parse(textOf(result));
    expect(body).toHaveLength(2);
  });

  it("get_team_dependencies defaults to outbound dependencies", async () => {
    const result = await client.callTool({
      name: "get_team_dependencies",
      arguments: { teamId: "stream-checkout" },
    });
    const body = JSON.parse(textOf(result));
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ from: "stream-checkout", to: "stream-onboarding", type: "Slowing" });
  });

  it("get_team_dependencies returns an error result for an unknown team", async () => {
    const result = await client.callTool({
      name: "get_team_dependencies",
      arguments: { teamId: "does-not-exist" },
    });
    expect(result.isError).toBe(true);
  });

  it("search_org searches across teams/services/roles/members", async () => {
    const result = await client.callTool({ name: "search_org", arguments: { query: "checkout" } });
    const body = JSON.parse(textOf(result));
    expect(body.length).toBeGreaterThan(0);
  });

  it("render_org_diagram returns mermaid text for the topology scope", async () => {
    const result = await client.callTool({
      name: "render_org_diagram",
      arguments: { scope: "topology", format: "mermaid" },
    });
    expect(textOf(result)).toContain("flowchart LR");
  });

  it("render_org_diagram returns a grouped hierarchy for the org-hierarchy scope", async () => {
    const result = await client.callTool({
      name: "render_org_diagram",
      arguments: { scope: "org-hierarchy", format: "mermaid" },
    });
    const text = textOf(result);
    expect(text).toContain("subgraph");
    expect(text).toContain("aligns with");
  });

  it("render_org_diagram renders the context-map scope in dot format", async () => {
    const result = await client.callTool({
      name: "render_org_diagram",
      arguments: { scope: "context-map", format: "dot" },
    });
    expect(textOf(result)).toContain("digraph");
  });

  it("render_org_diagram returns an error result for scope=hierarchy without a teamId", async () => {
    const result = await client.callTool({ name: "render_org_diagram", arguments: { scope: "hierarchy" } });
    expect(result.isError).toBe(true);
  });

  it("render_org_diagram returns an error result for an unknown teamId", async () => {
    const result = await client.callTool({
      name: "render_org_diagram",
      arguments: { scope: "topology", teamId: "does-not-exist" },
    });
    expect(result.isError).toBe(true);
  });

  it("get_context_map surfaces relationships", async () => {
    const result = await client.callTool({ name: "get_context_map", arguments: {} });
    const body = JSON.parse(textOf(result));
    expect(body.relationships.length).toBeGreaterThan(0);
  });

  it("get_context_map returns an error result for an unknown teamId", async () => {
    const result = await client.callTool({ name: "get_context_map", arguments: { teamId: "does-not-exist" } });
    expect(result.isError).toBe(true);
  });

  it("get_org_graph returns every team plus team-level and role-level edges", async () => {
    const result = await client.callTool({ name: "get_org_graph", arguments: {} });
    const body = JSON.parse(textOf(result));
    expect(body.teams).toHaveLength(4);
    expect(body.edges.length).toBeGreaterThan(0);
    expect(body.roleEdges.length).toBeGreaterThan(0);
  });

  it("get_org_cognitive_load_report sorts every team's assessment by total", async () => {
    const result = await client.callTool({ name: "get_org_cognitive_load_report", arguments: {} });
    const body = JSON.parse(textOf(result));
    expect(body[0].teamId).toBe("stream-checkout"); // highest total in the fixture
  });
});
