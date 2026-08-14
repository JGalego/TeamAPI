import * as path from "node:path";
import {
  buildOrgGraph,
  diffOrgGraphs,
  formatOrgGraphDiff,
  GitRefLoaderRegistry,
  gitRepoRoot,
  isEmptyDiff,
} from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface DiffOptions {
  /** A git revision to diff against — a branch, tag, or commit sha (e.g. "HEAD", "main", "v1.2.0"). */
  against: string;
  /** `json` emits the `OrgGraphDiff` itself. No SARIF: a diff is a description of change, not a
   * set of findings, and there is nothing here for a code scanner to annotate. */
  format?: "text" | "json";
}

/** Diffs the current (working-tree) resolved org graph against the same seed patterns as they
 * existed at a given git revision — added/removed teams, role/member/service changes, cognitive
 * load deltas, and edge changes. Requires running inside a git repository. */
export async function runDiff(patterns: string[], options: DiffOptions): Promise<number> {
  const format = options.format ?? "text";
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  // Resolved relative to the seed files' own location, not `process.cwd()` — `teamapi diff` can
  // be invoked from anywhere, and the target org's git repo isn't necessarily the caller's cwd.
  const repoRoot = await gitRepoRoot(path.dirname(seeds[0]!));
  if (!repoRoot) {
    console.error("`teamapi diff` requires running inside a git repository.");
    return 1;
  }

  const newGraph = await buildOrgGraph(resolveOptions(seeds));
  warnUnresolved(newGraph);

  let oldGraph;
  try {
    oldGraph = await buildOrgGraph({
      seedUris: seeds,
      allowPartial: true,
      loaders: new GitRefLoaderRegistry(options.against, repoRoot),
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (oldGraph.unresolved.length > 0) {
    console.error(
      `Warning: ${oldGraph.unresolved.length} unresolved reference(s) at ${options.against} — ` +
        'some data may be missing from the "before" side.',
    );
  }

  const diff = diffOrgGraphs(oldGraph, newGraph);
  if (format === "json") {
    console.log(JSON.stringify({ against: options.against, empty: isEmptyDiff(diff), diff }, null, 2));
    return 0;
  }

  if (isEmptyDiff(diff)) {
    console.log(`No differences between ${options.against} and the working tree.`);
    return 0;
  }

  console.log(formatOrgGraphDiff(diff));
  return 0;
}
