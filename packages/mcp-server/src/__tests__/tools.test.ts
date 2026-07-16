import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { OrgGraphStore } from "@teamapi/core";
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
        "get_context_map",
        "render_org_diagram",
        "search_org",
        "get_org_graph",
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

  it("find_service_owner finds the owning team", async () => {
    const result = await client.callTool({ name: "find_service_owner", arguments: { serviceName: "ledger" } });
    const body = JSON.parse(textOf(result));
    expect(body.teamId).toBe("platform-payments");
  });

  it("render_org_diagram returns mermaid text for the topology scope", async () => {
    const result = await client.callTool({
      name: "render_org_diagram",
      arguments: { scope: "topology", format: "mermaid" },
    });
    expect(textOf(result)).toContain("flowchart LR");
  });

  it("get_context_map surfaces relationships", async () => {
    const result = await client.callTool({ name: "get_context_map", arguments: {} });
    const body = JSON.parse(textOf(result));
    expect(body.relationships.length).toBeGreaterThan(0);
  });
});
