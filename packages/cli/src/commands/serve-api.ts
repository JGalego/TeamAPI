import { OrgGraphStore } from "@jgalego/teamapi-core";
import { buildServer } from "@jgalego/teamapi-rest-api";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface ServeApiOptions {
  port?: number;
  host?: string;
  /** Bearer token every request must carry. Defaults to `TEAMAPI_API_TOKEN`. */
  token?: string;
  corsOrigin?: string[];
  rateLimit?: number;
  /** Required to bind a non-loopback address with no token. */
  allowAnonymous?: boolean;
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
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    throw new Error(`No files matched: ${patterns.join(", ")}`);
  }

  const host = options.host ?? "127.0.0.1";
  const token = options.token ?? process.env.TEAMAPI_API_TOKEN;

  const refusal = checkExposure(host, token, options.allowAnonymous ?? false);
  if (refusal) throw new Error(refusal);

  const store = new OrgGraphStore({ seedUris: seeds, allowPartial: true });
  await store.load();
  warnUnresolved(store.current);

  const app = await buildServer(store, {
    logger: true,
    apiToken: token,
    corsOrigins: options.corsOrigin,
    rateLimitPerMinute: options.rateLimit,
  });
  const port = options.port ?? 3000;
  await app.listen({ port, host });

  console.log(`REST API listening on http://${host}:${port}`);
  console.log(token ? "Authentication: bearer token required" : "Authentication: none (loopback only)");
}
