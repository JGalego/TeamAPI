import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";

export type McpRequestHandler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;

export interface McpRoutesOptions {
  handler: McpRequestHandler;
}

/**
 * Mounts MCP over Streamable HTTP at `/mcp`, on the same port, behind the same bearer token as
 * everything else.
 *
 * The handler is injected rather than constructed here, so this package keeps knowing nothing
 * about MCP — the CLI, which already depends on both, supplies it. Same shape as the `reload`
 * option: the route exists to expose a capability the caller decided to enable.
 *
 * The transport writes to the raw Node response itself (it streams, and may hold the response open
 * for server-sent events), so this hands over `reply.raw` and then tells Fastify the reply has
 * been taken over with `reply.hijack()`. Without that, Fastify would consider the handler's
 * resolution its cue to send its own response onto a socket the transport is still using.
 */
export async function mcpRoutes(app: FastifyInstance, options: McpRoutesOptions): Promise<void> {
  app.post(
    "/mcp",
    {
      schema: {
        tags: ["MCP"],
        summary: "Model Context Protocol endpoint (Streamable HTTP)",
        description:
          "Serves the same tools as `teamapi serve-mcp` over HTTP, so an org can host one shared " +
          "endpoint instead of every client running a local server against its own checkout. " +
          "Stateless: no session id is issued or required.",
      },
    },
    async (request, reply) => {
      reply.hijack();
      await options.handler(request.raw, reply.raw, request.body);
    },
  );
}
