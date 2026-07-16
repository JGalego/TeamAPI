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
} from "@teamapi/core";
import { expandSeeds } from "../seeds";

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
  const format = options.format ?? "mermaid";
  const render = (model: DiagramModel) => (format === "dot" ? toDot(model) : toMermaid(model));

  let output: string;
  if (options.scope === "hierarchy") {
    if (!options.team) {
      console.error("`--scope hierarchy` requires `--team <id>`");
      return 1;
    }
    output = render(buildHierarchyDiagram(graph, options.team));
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
