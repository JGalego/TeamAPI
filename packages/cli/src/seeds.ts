import * as fs from "node:fs/promises";
import fg from "fast-glob";

async function isDirectory(pattern: string): Promise<boolean> {
  try {
    return (await fs.stat(pattern)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Expands CLI glob patterns / literal paths / directories into a de-duplicated, sorted list of
 * absolute file paths. A pattern that resolves to an existing directory is treated as "discover
 * every `teamapi.yml`/`teamapi.yaml` anywhere under here", so callers can point at a folder
 * (e.g. `examples/acme-org`) instead of hand-writing `**\/teamapi.yml`.
 */
export async function expandSeeds(patterns: string[]): Promise<string[]> {
  const globs = await Promise.all(
    patterns.map(async (pattern) => {
      if (!(await isDirectory(pattern))) return [pattern];
      const dir = pattern.replace(/\\/g, "/").replace(/\/+$/, "");
      return [`${dir}/**/teamapi.yml`, `${dir}/**/teamapi.yaml`];
    }),
  );

  const matches = await fg(globs.flat(), { absolute: true, onlyFiles: true });
  return [...new Set(matches)].sort();
}
