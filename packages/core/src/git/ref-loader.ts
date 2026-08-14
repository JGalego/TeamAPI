import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as YAML from "js-yaml";
import { LoaderRegistry, type LoadedDocument } from "../resolve/loaders";

const execFileAsync = promisify(execFile);

/**
 * A `LoaderRegistry` that reads every file's content as it existed at a fixed git revision
 * (`git show <ref>:<path>`) instead of from the working tree.
 *
 * `$ref` resolution itself is unchanged (inherited from `LoaderRegistry`) — only *what content* a
 * given path resolves to changes, which is exactly what lets `buildOrgGraph` build "the org as of
 * `ref`" using the same resolution logic it always uses. That matters more than it sounds: a
 * historical snapshot built by a second, simpler resolver would answer differently from the live
 * one for reasons that have nothing to do with the org changing.
 */
export class GitRefLoaderRegistry extends LoaderRegistry {
  constructor(
    private readonly ref: string,
    private readonly repoRoot: string,
  ) {
    super();
  }

  override async load(uri: string): Promise<LoadedDocument> {
    const relPath = path.relative(this.repoRoot, uri).split(path.sep).join("/");
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync("git", ["show", `${this.ref}:${relPath}`], {
        cwd: this.repoRoot,
        maxBuffer: 10 * 1024 * 1024,
      }));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`git show ${this.ref}:${relPath} failed (file may not have existed at that revision): ${reason}`);
    }
    return { canonicalUri: uri, raw: YAML.load(stdout) };
  }
}

/** The repository root containing `cwd`, or `undefined` when there isn't one. */
export async function gitRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** `git log --format` emits this between fields. A NUL, because a commit subject can contain any
 * printable character including every plausible alternative — a tab, a pipe, a run of spaces. */
const RECORD_SEPARATOR = "\u0000";

export interface GitRevision {
  sha: string;
  /** Author date, ISO 8601. Author rather than committer, so a rebase does not restate when the
   * org actually changed. */
  date: string;
  subject: string;
}

export interface ListRevisionsOptions {
  /** Only commits touching these paths. Relative to the repository root. */
  paths?: string[];
  /** `git log --since`, e.g. "1 year ago" or "2026-01-01". */
  since?: string;
  /** Maximum commits to consider, newest first. */
  limit?: number;
}

/**
 * Commits that touched the org's documents, oldest first.
 *
 * Path-filtered on purpose: a repository's history is mostly commits that changed nothing about
 * the org, and resolving the graph at each of them would be minutes of work to plot a flat line.
 */
export async function listRevisions(repoRoot: string, options: ListRevisionsOptions = {}): Promise<GitRevision[]> {
  const args = ["log", "--format=%H%x00%aI%x00%s"];
  if (options.since) args.push(`--since=${options.since}`);
  if (options.limit) args.push(`--max-count=${options.limit}`);
  if (options.paths?.length) args.push("--", ...options.paths);

  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [sha, date, subject] = line.split(RECORD_SEPARATOR);
      return { sha: sha!, date: date!, subject: subject ?? "" };
    })
    .reverse();
}

/**
 * Thins a list of revisions to at most one per calendar period.
 *
 * A busy org produces hundreds of commits a year, and a trend line does not get truer for having
 * three hundred points instead of twelve — it gets slower to compute and harder to read. The last
 * commit in each period is kept, so a period reads as "where the org ended up", which is the
 * question a quarterly view is asking.
 */
export function sampleRevisions(
  revisions: GitRevision[],
  period: "commit" | "day" | "week" | "month" | "quarter",
): GitRevision[] {
  if (period === "commit") return revisions;

  const keyOf = (iso: string): string => {
    const date = new Date(iso);
    const year = date.getUTCFullYear();
    if (period === "day") return iso.slice(0, 10);
    if (period === "month") return iso.slice(0, 7);
    if (period === "quarter") return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
    // ISO week, near enough: the day-of-year bucket by sevens. Exact ISO week numbering would
    // move a handful of boundary commits by one bucket and change no trend anybody reads.
    const startOfYear = Date.UTC(year, 0, 1);
    const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000);
    return `${year}-W${String(Math.floor(dayOfYear / 7)).padStart(2, "0")}`;
  };

  const byPeriod = new Map<string, GitRevision>();
  for (const revision of revisions) byPeriod.set(keyOf(revision.date), revision);
  return [...byPeriod.values()];
}
