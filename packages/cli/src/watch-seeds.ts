import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expandSeeds } from "./seeds";

/**
 * Drops any directory already contained in another, because the watches are recursive: keeping
 * both a parent and its child would deliver two events for one change and reload twice.
 */
export function collapseNested(dirs: string[]): string[] {
  const roots: string[] = [];
  for (const dir of [...new Set(dirs)].sort()) {
    if (!roots.some((root) => dir === root || dir.startsWith(`${root}${path.sep}`))) roots.push(dir);
  }
  return roots;
}

/**
 * The directories to watch for a given set of CLI patterns.
 *
 * Watching the resolved seed *files* would be the obvious choice and is the wrong one: a document
 * added after startup would never be noticed, which is the case a growing org hits first. So each
 * pattern contributes a directory — itself, when the user pointed at one, and otherwise the
 * directory its matched files sit in.
 *
 * Anchoring on the directory the user named (rather than on where the `teamapi.yml` files happen
 * to be today) is what makes `teamapi serve-api examples/acme-org --watch` notice
 * `examples/acme-org/new-team/teamapi.yml` appearing later.
 */
export async function resolveWatchRoots(patterns: string[]): Promise<string[]> {
  const roots: string[] = [];

  for (const pattern of patterns) {
    const resolved = path.resolve(pattern);
    if (await isDirectory(resolved)) {
      roots.push(resolved);
      continue;
    }
    // A glob or a file path: watch wherever its current matches live.
    const matches = await expandSeeds([pattern]);
    roots.push(...matches.map((match) => path.dirname(match)));
  }

  return collapseNested(roots);
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}
