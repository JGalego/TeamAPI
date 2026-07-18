import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OrgGraphStore } from "@jgalego/teamapi-core";
import { registerTools } from "./tools/register";

export function createMcpServer(store: OrgGraphStore): McpServer {
  const server = new McpServer({ name: "team-api-mcp-server", version: "0.1.0" });
  registerTools(server, store);
  return server;
}
