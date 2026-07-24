import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OrgGraphStore } from "@jgalego/teamapi-core";
import { registerTools } from "./tools/register";

// Read at runtime (not imported as a TS module) so this keeps working both from `dist/` in the
// monorepo and once published, without fighting `rootDir`/project-reference boundaries.
const packageVersion = (JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string })
  .version;

export function createMcpServer(store: OrgGraphStore): McpServer {
  const server = new McpServer({ name: "team-api-mcp-server", version: packageVersion });
  registerTools(server, store);
  return server;
}
