import { OrgGraphStore } from "@jgalego/teamapi-core";
import { createMcpServer } from "@jgalego/teamapi-mcp-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { expandSeeds } from "../seeds";

/** Note: never write to stdout here — it's the MCP protocol channel. Status goes to stderr only. */
export async function runServeMcp(patterns: string[]): Promise<void> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    throw new Error(`No files matched: ${patterns.join(", ")}`);
  }

  const store = new OrgGraphStore({ seedUris: seeds, allowPartial: true });
  await store.load();

  const server = createMcpServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP server connected over stdio (${store.current.teams.size} team(s) resolved).`);
}
