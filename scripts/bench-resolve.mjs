#!/usr/bin/env node
// Resolution benchmark over a synthetic org, so "where does this break?" has an answer that is not
// a guess. Run after `pnpm build`:
//
//   pnpm bench:resolve                       # 50 / 200 / 1000 teams, local filesystem
//   pnpm bench:resolve 2000                  # one size
//   pnpm bench:resolve 500 --latency 30      # 30ms per document, standing in for a remote org
//
// Two seeding modes are measured, because they are the two ways this is actually used and they
// behave completely differently:
//
//   all   `teamapi validate ./org` — every document is discovered on disk first, so the whole org
//         arrives as one BFS level and concurrency has everything to work with.
//   one   a single root document whose $refs reach the rest, which is what a remote org looks
//         like. The frontier grows level by level, so the ceiling is the graph's depth.
//
// The `--latency` mode is where this matters. On a local filesystem the loads are already fast
// enough that the win is modest; make every load a round trip and a serial resolver's total
// becomes the sum of every fetch rather than the sum of the slowest per level.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const core = await import("../packages/core/dist/index.js").catch(() => {
  throw new Error("packages/core is not built. Run `pnpm build` first.");
});
const { buildOrgGraph, LoaderRegistry, generateSyntheticOrg } = core;

const args = process.argv.slice(2);
const latencyIndex = args.indexOf("--latency");
const latencyMs = latencyIndex === -1 ? 0 : Number(args[latencyIndex + 1]);
// Drop the latency value itself before reading the sizes, or `--latency 5` silently adds a
// five-team run to the list.
const positional = args.filter((_, i) => i !== latencyIndex && i !== latencyIndex + 1);
const sizes = positional.filter((arg) => /^\d+$/.test(arg)).map(Number);
const SIZES = sizes.length > 0 ? sizes : [50, 200, 1000];
const CONCURRENCIES = [1, 4, 8, 32];

/** Adds a fixed delay to every load, standing in for a network round trip. */
class SlowRegistry extends LoaderRegistry {
  async load(uri) {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    return super.load(uri);
  }
}

const ms = (value) => `${value.toFixed(0)}ms`.padStart(9);

for (const teams of SIZES) {
  const root = mkdtempSync(join(tmpdir(), "teamapi-bench-"));
  try {
    const org = generateSyntheticOrg(root, { teams });
    console.log(`\n${org.files.length} teams${latencyMs ? ` @ ${latencyMs}ms/doc` : ""}`);

    for (const [mode, seedUris] of [
      ["all", org.files],
      ["one", [org.streamFiles[0]]],
    ]) {
      console.log(`  seeds=${mode}  concurrency      total   speedup`);
      let serialTotal;
      for (const concurrency of CONCURRENCIES) {
        const started = performance.now();
        const graph = await buildOrgGraph({
          seedUris,
          allowPartial: true,
          concurrency,
          loaders: new SlowRegistry(),
        });
        const elapsed = performance.now() - started;
        serialTotal ??= elapsed;

        if (graph.teams.size !== org.files.length) {
          throw new Error(`Resolved ${graph.teams.size} of ${org.files.length} teams — benchmark is measuring a bug`);
        }
        const speedup = concurrency === 1 ? "" : `   ${(serialTotal / elapsed).toFixed(1)}x`;
        console.log(`              ${String(concurrency).padStart(11)}${ms(elapsed)}${speedup}`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
