import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildCrewAiCrewConfig,
  buildCrewAiOrgConfig,
  buildOrgGraph,
  toCrewAiCrewYaml,
  toCrewAiOrgYaml,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";

export interface GenerateOptions {
  target: "crewai";
  team?: string;
  out: string;
}

export async function runGenerate(patterns: string[], options: GenerateOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });

  if (options.team) {
    if (!graph.teams.has(options.team)) {
      console.error(`Unknown team id: ${options.team}`);
      return 1;
    }
    const crew = buildCrewAiCrewConfig(graph, options.team);
    const { agentsYaml, tasksYaml } = toCrewAiCrewYaml(crew);
    await fs.mkdir(options.out, { recursive: true });
    await fs.writeFile(path.join(options.out, "agents.yaml"), agentsYaml, "utf-8");
    await fs.writeFile(path.join(options.out, "tasks.yaml"), tasksYaml, "utf-8");
    console.log(`Wrote ${path.join(options.out, "agents.yaml")}, ${path.join(options.out, "tasks.yaml")}`);
    return 0;
  }

  const org = buildCrewAiOrgConfig(graph);
  const { orgYaml, crews } = toCrewAiOrgYaml(org);
  await fs.mkdir(options.out, { recursive: true });
  await fs.writeFile(path.join(options.out, "org.yaml"), orgYaml, "utf-8");
  for (const crew of crews) {
    const crewDir = path.join(options.out, crew.teamId);
    await fs.mkdir(crewDir, { recursive: true });
    await fs.writeFile(path.join(crewDir, "agents.yaml"), crew.agentsYaml, "utf-8");
    await fs.writeFile(path.join(crewDir, "tasks.yaml"), crew.tasksYaml, "utf-8");
  }
  console.log(`Wrote ${crews.length} crew(s) + org.yaml to ${options.out}/`);
  return 0;
}
