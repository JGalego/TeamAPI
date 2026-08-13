import type { FastifyInstance } from "fastify";

export interface ReloadRoutesOptions {
  /** Performs the reload. Supplied by the caller so the route stays ignorant of watching, seed
   * discovery and debouncing — it only triggers whatever the server was configured to do. */
  reload: () => Promise<void>;
}

/**
 * `POST /reload` — re-resolve the org graph on demand.
 *
 * Mounted only when the server was started with a reload mechanism, which keeps the API read-only
 * by default: this is the one endpoint that changes what every other endpoint returns, so it
 * should not exist unless somebody asked for it. It is covered by the same bearer-token check as
 * everything else, which matters more here than elsewhere — an unauthenticated reload is a free
 * way to make a server do unbounded filesystem work.
 *
 * Intended for a post-receive/CI webhook: the documents are in git, so "they changed" is something
 * the git host already knows and can say, without this process polling for it.
 */
export async function reloadRoutes(app: FastifyInstance, options: ReloadRoutesOptions): Promise<void> {
  app.post(
    "/reload",
    {
      schema: {
        tags: ["Health"],
        summary: "Re-resolve the org graph from disk",
        description:
          "Rebuilds the graph from the Team API documents on disk. Available only when the server " +
          "was started with --watch or --reload-endpoint.",
      },
    },
    async () => {
      await options.reload();
      const graph = app.orgGraphStore.current;
      return {
        status: "reloaded",
        teams: graph.teams.size,
        unresolved: graph.unresolved.length,
        resolvedAt: graph.meta.resolvedAt,
      };
    },
  );
}
