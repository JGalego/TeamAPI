import * as fs from "node:fs/promises";
import {
  buildContextMapDiagram,
  buildHierarchyDiagram,
  buildOrgGraph,
  buildOrgHierarchyDiagram,
  buildTopologyDiagram,
  deriveContextMap,
  toDot,
  toMermaid,
  type DiagramModel,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface RenderOptions {
  scope: "topology" | "hierarchy" | "context-map" | "org-hierarchy";
  format?: "mermaid" | "dot";
  team?: string;
  out?: string;
}

export async function runRender(patterns: string[], options: RenderOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  if (options.scope === "hierarchy" && !options.team) {
    console.error("`--scope hierarchy` requires `--team <id>`");
    return 1;
  }
  if (options.scope === "org-hierarchy" && options.team) {
    console.error("`--team` has no effect with `--scope org-hierarchy` (every team's hierarchy is always shown)");
    return 1;
  }
  // Same check, same message, for every scope that actually uses `--team` — `hierarchy` used to
  // throw this from deep inside `buildHierarchyDiagram` while `topology`/`context-map` silently
  // rendered an empty diagram instead; both now fail the same clean way up front.
  if (options.team && options.scope !== "org-hierarchy" && !graph.teams.has(options.team)) {
    console.error(`Unknown team id: ${options.team}`);
    return 1;
  }

  const format = options.format ?? "mermaid";
  const render = (model: DiagramModel) => (format === "dot" ? toDot(model) : toMermaid(model));

  let output: string;
  if (options.scope === "hierarchy") {
    output = render(buildHierarchyDiagram(graph, options.team as string));
  } else if (options.scope === "org-hierarchy") {
    output = render(buildOrgHierarchyDiagram(graph));
  } else if (options.scope === "context-map") {
    output = render(buildContextMapDiagram(graph, deriveContextMap(graph, options.team), options.team));
  } else {
    output = render(buildTopologyDiagram(graph, options.team));
  }

  if (options.out) {
    await fs.writeFile(options.out, output, "utf-8");
    console.log(`Wrote ${options.out}`);
  } else {
    console.log(output);
  }
  return 0;
}
