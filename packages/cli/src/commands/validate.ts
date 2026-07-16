import { buildOrgGraph } from "@teamapi/core";
import { expandSeeds } from "../seeds";

export async function runValidate(patterns: string[]): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });

  console.log(`Resolved ${graph.teams.size} team(s) from ${seeds.length} seed file(s):`);
  for (const team of [...graph.teams.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(`  - ${team.id} (${team.doc.info.type}) <- ${team.sourceUri}`);
  }

  if (graph.unresolved.length > 0) {
    console.error(`\n${graph.unresolved.length} unresolved reference(s):`);
    for (const u of graph.unresolved) {
      console.error(`  - ${u.ref}: ${u.reason}`);
    }
    return 1;
  }

  console.log("\nNo unresolved references. Validation passed.");
  return 0;
}
