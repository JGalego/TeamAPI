import { OrgGraphStore, watchOrgGraph } from "@jgalego/teamapi-core";
import { createMcpServer } from "@jgalego/teamapi-mcp-server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { expandSeeds } from "../seeds";
import { resolveWatchRoots } from "../watch-seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface ServeMcpOptions {
  /** Re-resolve the graph when a watched document changes. */
  watch?: boolean;
}

/** Note: never write to stdout here — it's the MCP protocol channel. Status goes to stderr only. */
export async function runServeMcp(patterns: string[], options: ServeMcpOptions = {}): Promise<void> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    throw new Error(`No files matched: ${patterns.join(", ")}`);
  }

  const store = new OrgGraphStore({ seedUris: seeds, allowPartial: true });
  await store.load();
  warnUnresolved(store.current);

  // Worth more here than on the REST API: an assistant holds an MCP connection open for the whole
  // length of a session, so without this it would answer from whatever the org looked like when
  // the editor started — which may be days ago.
  const watcher = options.watch
    ? watchOrgGraph({
        store,
        watchPaths: await resolveWatchRoots(patterns),
        resolveSeeds: () => expandSeeds(patterns),
        onReload: (graph) => console.error(`Reloaded: ${graph.teams.size} team(s).`),
        onError: (error) => console.error(`Reload failed, still serving the last good graph: ${error.message}`),
      })
    : undefined;

  if (watcher) process.on("SIGHUP", () => void watcher.reload());

  const server = createMcpServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `MCP server connected over stdio (${store.current.teams.size} team(s) resolved` +
      `${watcher ? ", watching for changes" : ""}).`,
  );
}
