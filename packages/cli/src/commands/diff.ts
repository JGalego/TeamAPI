import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as YAML from "js-yaml";
import {
  buildOrgGraph,
  diffOrgGraphs,
  formatOrgGraphDiff,
  isEmptyDiff,
  LoaderRegistry,
  type LoadedDocument,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

const execFileAsync = promisify(execFile);

export interface DiffOptions {
  /** A git revision to diff against — a branch, tag, or commit sha (e.g. "HEAD", "main", "v1.2.0"). */
  against: string;
}

/**
 * A `LoaderRegistry` that reads every file's content as it existed at a fixed git revision
 * (`git show <ref>:<path>`) instead of from the working tree. `$ref` resolution itself is
 * unchanged (inherited from `LoaderRegistry`) — only *what content* a given path resolves to
 * changes, which is exactly what lets `buildOrgGraph` build "the org as of `ref`" using the same
 * resolution logic it always uses.
 */
class GitRefLoaderRegistry extends LoaderRegistry {
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

async function gitRepoRoot(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** Diffs the current (working-tree) resolved org graph against the same seed patterns as they
 * existed at a given git revision — added/removed teams, role/member/service changes, cognitive
 * load deltas, and edge changes. Requires running inside a git repository. */
export async function runDiff(patterns: string[], options: DiffOptions): Promise<number> {
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

  const newGraph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
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
        "some data may be missing from the \"before\" side.",
    );
  }

  const diff = diffOrgGraphs(oldGraph, newGraph);
  if (isEmptyDiff(diff)) {
    console.log(`No differences between ${options.against} and the working tree.`);
    return 0;
  }

  console.log(formatOrgGraphDiff(diff));
  return 0;
}
