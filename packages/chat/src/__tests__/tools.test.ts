import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "@jgalego/teamapi-core";
import { buildChatTools } from "../tools";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

const EXPECTED_TOOL_NAMES = [
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
  "get_org_cognitive_load_report",
];

describe("buildChatTools — examples/acme-org", () => {
  it("builds one tool per org-graph operation, matching the MCP tool set", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const tools = buildChatTools(graph);

    expect(tools.map((t) => t.name)).toEqual(EXPECTED_TOOL_NAMES);
  });

  it("find_service_owner resolves a real service to its owning team", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    // Each tool in the array has its own `run` input type, so `Array.find` can't narrow it —
    // cast to `any` here purely for the test call; `tools.ts` itself is fully typed.
    const tools = buildChatTools(graph) as any[];
    const findServiceOwner = tools.find((t) => t.name === "find_service_owner");

    const result = await findServiceOwner.run({ serviceName: "checkout-api" });
    expect(result).toContain("stream-checkout");
  });

  it("get_team reports an unknown team id as an error string rather than throwing", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const tools = buildChatTools(graph) as any[];
    const getTeam = tools.find((t) => t.name === "get_team");

    const result = await getTeam.run({ teamId: "does-not-exist" });
    expect(result).toContain("Error");
  });

  it("invokes onToolCall with the tool name, input, and output — for --debug", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const calls: Array<{ name: string; input: unknown; output: string }> = [];
    const tools = buildChatTools(graph, { onToolCall: (call) => calls.push(call) }) as any[];
    const getTeam = tools.find((t) => t.name === "get_team");

    await getTeam.run({ teamId: "stream-checkout" });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call).toMatchObject({ name: "get_team", input: { teamId: "stream-checkout" } });
    expect(call!.output).toContain("stream-checkout");
  });
});
