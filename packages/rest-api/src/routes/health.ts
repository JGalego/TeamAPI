import type { FastifyInstance } from "fastify";

/** Which optional surfaces this server was started with. */
export interface ServerCapabilities {
  /** `POST /teams/:id/proposals` is mounted. */
  proposals: boolean;
  /** `GET /search?mode=hybrid|semantic` and `POST /context {semantic:true}` will work. */
  semanticSearch: boolean;
  /** `GET /metrics` is mounted. */
  metrics: boolean;
  /** `POST /reload` is mounted. */
  reload: boolean;
  /** `POST /mcp` is mounted. */
  mcp: boolean;
}

/**
 * Liveness, plus what this server can do.
 *
 * The capabilities are here rather than in a route of their own because every optional surface on
 * this API is a decision somebody made at startup, and a client — the dashboard especially — has
 * no other way to tell an endpoint that is switched off from one that does not exist in this
 * build. Probing for it means either a 404 that looks like an old server or a request that changes
 * something, and offering an edit button that 404s is worse than not offering one.
 *
 * `/health` is the one route that never requires a token, so this discloses nothing beyond which
 * features are on — no team names, no counts.
 */
export async function healthRoutes(app: FastifyInstance, capabilities: ServerCapabilities): Promise<void> {
  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        summary: "Liveness check, and which optional surfaces are mounted",
      },
    },
    async () => ({ status: "ok", capabilities }),
  );
}
