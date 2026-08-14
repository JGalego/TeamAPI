import type { BuildOrgGraphOptions } from "@jgalego/teamapi-core";

/** Set to any non-empty value to resolve without touching the on-disk cache. */
const DISABLE = "TEAMAPI_NO_CACHE";
/** Where cached remote documents live. Relative paths are relative to the working directory. */
const CACHE_DIR = "TEAMAPI_CACHE_DIR";
/** How many documents may be in flight at once. */
const CONCURRENCY = "TEAMAPI_RESOLVE_CONCURRENCY";

function positiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * The resolution options every CLI command shares: partial resolution, an on-disk cache for
 * `https://` refs, and a fetch concurrency.
 *
 * Read from the environment rather than `teamapi.config.yml`, and deliberately. That file lives in
 * the repository and holds facts about the *org* — its GitHub login, its Okta URL. A cache
 * directory is a fact about the *machine*: CI wants it inside whatever path its cache action
 * restores, a developer wants it out of the way, and a container wants it on a writable volume.
 * Three different answers for one org is exactly what an environment variable is for.
 *
 * The cache is on by default because the case it helps is the case nobody thinks to configure:
 * an org whose documents live behind `https://`, re-resolved on every command. It is advisory in
 * both directions — an unwritable or corrupt cache degrades to a plain fetch rather than failing.
 */
export function resolveOptions(seeds: string[], env: NodeJS.ProcessEnv = process.env): BuildOrgGraphOptions {
  // `TEAMAPI_CACHE_DIR=` (exported empty, which is how a CI matrix routinely un-sets a variable)
  // means "unset", not "cache into the current working directory".
  const dir = env[CACHE_DIR] === undefined || env[CACHE_DIR] === "" ? undefined : env[CACHE_DIR];
  return {
    seedUris: seeds,
    allowPartial: true,
    concurrency: positiveInt(env[CONCURRENCY]),
    cache: env[DISABLE] ? undefined : { dir },
  };
}
