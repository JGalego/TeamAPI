import * as path from "node:path";
import {
  buildOrgGraph,
  formatHistory,
  GitRefLoaderRegistry,
  gitRepoRoot,
  historyToCsv,
  listRevisions,
  sampleRevisions,
  snapshotOrg,
  withChurn,
  type HistoryPoint,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";

export type HistoryPeriod = "commit" | "day" | "week" | "month" | "quarter";
export const HISTORY_PERIODS: readonly HistoryPeriod[] = ["commit", "day", "week", "month", "quarter"];

export interface HistoryOptions {
  /** One snapshot per period; `commit` means every commit that touched the documents. */
  period?: HistoryPeriod;
  /** `git log --since`, e.g. "1 year ago". */
  since?: string;
  /** Maximum commits to consider before sampling. */
  limit?: number;
  format?: "text" | "json" | "csv";
}

const DEFAULT_LIMIT = 500;

/**
 * Resolves the org graph at a series of past revisions and reports how it changed.
 *
 * `teamapi diff` answers "what changed between these two commits". This answers the questions that
 * only have an answer over time and therefore had none: is cognitive load creeping up across
 * quarters, is agent adoption accelerating, is supervision load growing without anybody scoring
 * it, how much team churn is there really. All of that is already in git — it just needed
 * resolving at more than one point.
 *
 * Revisions are resolved one at a time rather than concurrently. Each one shells out to
 * `git show` per document, and a dozen parallel resolutions of a large org is a lot of processes
 * for a report nobody is waiting on with a stopwatch.
 */
export async function runHistory(patterns: string[], options: HistoryOptions = {}): Promise<number> {
  const format = options.format ?? "text";
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  // Relative to the seed files, not the working directory: this can be run from anywhere, and the
  // org's repository is not necessarily the caller's.
  const repoRoot = await gitRepoRoot(path.dirname(seeds[0]!));
  if (!repoRoot) {
    console.error("`teamapi history` requires running inside a git repository.");
    return 1;
  }

  const relativeSeeds = seeds.map((seed) => path.relative(repoRoot, seed).split(path.sep).join("/"));
  const revisions = sampleRevisions(
    await listRevisions(repoRoot, {
      paths: relativeSeeds,
      since: options.since,
      limit: options.limit ?? DEFAULT_LIMIT,
    }),
    options.period ?? "month",
  );

  if (revisions.length === 0) {
    console.error("No commits touched these documents in the selected range.");
    return 1;
  }

  const points: Array<Omit<HistoryPoint, "teamsAdded" | "teamsRemoved">> = [];
  for (const revision of revisions) {
    try {
      const graph = await buildOrgGraph({
        seedUris: seeds,
        allowPartial: true,
        loaders: new GitRefLoaderRegistry(revision.sha, repoRoot),
      });
      points.push({ ...revision, snapshot: snapshotOrg(graph) });
    } catch (err) {
      // A revision predating some of today's documents cannot be resolved from today's seed list,
      // and that is ordinary rather than exceptional — the org had fewer teams then. Skipping it
      // with a note beats failing the whole report over the oldest point in it.
      console.error(
        `Skipping ${revision.sha.slice(0, 8)} (${revision.date.slice(0, 10)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (points.length === 0) {
    console.error("No revision in the selected range could be resolved.");
    return 1;
  }

  const history = withChurn(points);
  if (format === "json") console.log(JSON.stringify(history, null, 2));
  else if (format === "csv") console.log(historyToCsv(history));
  else console.log(formatHistory(history));

  // Always 0: this is an inspection tool, not a gate. `gaps`, `policy` and `topology` are the
  // commands that fail a build; a trend is a thing to look at.
  return 0;
}
