import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OrgGraphStore } from "@jgalego/teamapi-core";
import { createMcpServer } from "./server";

/**
 * Serves MCP over Streamable HTTP, so an org can host one endpoint instead of every person
 * running `serve-mcp` against their own checkout.
 *
 * Stdio is the right transport for a local assistant and the wrong one for an organization: it
 * requires the documents on the same machine as the model, which means every laptop holds its own
 * copy of the org graph, each as current as the last time somebody pulled. One HTTP endpoint in
 * front of one repository is the same answer for everybody, and it is answered by whatever the
 * server last reloaded.
 *
 * **Stateless.** A fresh `McpServer` and transport are constructed per request and disposed at the
 * end of it. That is unusual for MCP, where a session normally lives as long as a connection, and
 * it is right here for a specific reason: every tool this server exposes is a pure read of the org
 * graph, so there is no per-client state worth keeping between calls. Nothing is gained by
 * remembering a client, and a great deal is gained by not having to — no session table, no
 * expiry, no sticky routing, and any instance behind a load balancer can answer any request.
 */
export type McpHttpHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;

export function createMcpHttpHandler(store: OrgGraphStore): McpHttpHandler {
  return async (req, res, body) => {
    const server = createMcpServer(store);
    // `sessionIdGenerator: undefined` is what selects stateless mode in the SDK: no session id is
    // issued, none is demanded on later requests, and no state survives this function.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    // Closing the transport when the response ends is what keeps a long-lived process from
    // accumulating one transport per request it has ever served.
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}
