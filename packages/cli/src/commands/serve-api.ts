import { OrgGraphStore, watchOrgGraph } from "@jgalego/teamapi-core";
import { buildServer } from "@jgalego/teamapi-rest-api";
import { expandSeeds } from "../seeds";
import { resolveWatchRoots } from "../watch-seeds";
import { warnUnresolved } from "../warn-unresolved";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface ServeApiOptions extends ConfigAwareOptions {
  port?: number;
  host?: string;
  /** Bearer token every request must carry. Defaults to `TEAMAPI_API_TOKEN`. */
  token?: string;
  corsOrigin?: string[];
  rateLimit?: number;
  /** Required to bind a non-loopback address with no token. */
  allowAnonymous?: boolean;
  /** Re-resolve the graph when a watched document changes. */
  watch?: boolean;
  /** Mount `POST /reload` even without `--watch`, for a webhook-driven refresh. */
  reloadEndpoint?: boolean;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

/**
 * Refuses the one combination that turns a convenience into an incident: a host other machines can
 * reach, serving the full org chart — every person, their contact details, who reports to whom —
 * with no credential at all.
 *
 * It is a refusal rather than a warning because a warning scrolls past in a terminal nobody is
 * watching, and the failure mode is silent by construction: an exposed server looks exactly like a
 * working one. `--allow-anonymous` is there for the case where that really is the intent (a
 * read-only mirror on a trusted network, a demo), so the escape hatch exists but has to be typed.
 */
export function checkExposure(host: string, token: string | undefined, allowAnonymous: boolean): string | undefined {
  if (isLoopbackHost(host) || token || allowAnonymous) return undefined;
  return (
    `Refusing to listen on ${host} without a token: this would serve the whole org graph, ` +
    `including every member's contact details, to anything that can reach this port.\n` +
    `Pass --token <token> (or set TEAMAPI_API_TOKEN), or --allow-anonymous if that is really what you want.`
  );
}

export async function runServeApi(patterns: string[], options: ServeApiOptions): Promise<void> {
  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) throw new Error(input.error);
  if (input.patterns.length === 0) throw new Error(NO_PATTERNS_MESSAGE);

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    throw new Error(`No files matched: ${input.patterns.join(", ")}`);
  }

  // CLI flag, then config, then the built-in default. The token is the exception: it is read from
  // the environment and never from the config file, which lives in the repository.
  const serve = input.config.defaults.serve;
  const host = options.host ?? serve.host ?? "127.0.0.1";
  const token = options.token ?? process.env.TEAMAPI_API_TOKEN;

  const refusal = checkExposure(host, token, options.allowAnonymous ?? false);
  if (refusal) throw new Error(refusal);

  const store = new OrgGraphStore({ seedUris: seeds, allowPartial: true });
  await store.load();
  warnUnresolved(store.current);

  const corsOrigin = options.corsOrigin ?? serve.corsOrigin;
  const rateLimit = options.rateLimit ?? serve.rateLimit;

  const watcher =
    options.watch || options.reloadEndpoint
      ? watchOrgGraph({
          store,
          // No roots when only `--reload-endpoint` was asked for: the endpoint reloads on demand,
          // and installing filesystem watches nobody asked for would be a surprise on a server
          // whose documents are deployed rather than edited in place.
          watchPaths: options.watch ? await resolveWatchRoots(input.patterns) : [],
          resolveSeeds: () => expandSeeds(input.patterns),
          onReload: (graph) =>
            console.log(`Reloaded: ${graph.teams.size} team(s), ${graph.unresolved.length} unresolved reference(s).`),
          onError: (error) => console.error(`Reload failed, still serving the last good graph: ${error.message}`),
        })
      : undefined;

  const app = await buildServer(store, {
    logger: true,
    apiToken: token,
    corsOrigins: corsOrigin,
    rateLimitPerMinute: rateLimit,
    reload: watcher ? () => watcher.reload() : undefined,
  });

  // The Unix idiom for "re-read your configuration" — the one trigger that needs neither a
  // filesystem watch nor an open port, and that every process supervisor already knows how to send.
  if (watcher) process.on("SIGHUP", () => void watcher.reload());

  const port = options.port ?? serve.port ?? 3000;
  await app.listen({ port, host });

  console.log(`REST API listening on http://${host}:${port}`);
  console.log(token ? "Authentication: bearer token required" : "Authentication: none (loopback only)");
  if (watcher) {
    console.log(
      options.watch
        ? "Reload: on file change, POST /reload, or SIGHUP"
        : "Reload: POST /reload, or SIGHUP (no file watching)",
    );
  }
}
