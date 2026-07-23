import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildBackstageCatalog,
  buildBackstageOrgCatalog,
  buildCrewAiCrewConfig,
  buildCrewAiOrgConfig,
  buildOrgGraph,
  toBackstageYaml,
  toCrewAiCrewYaml,
  toCrewAiOrgYaml,
  type OrgGraph,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface GenerateOptions {
  target: "crewai" | "backstage";
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
  warnUnresolved(graph);

  if (options.team && !graph.teams.has(options.team)) {
    console.error(`Unknown team id: ${options.team}`);
    return 1;
  }

  if (options.target === "backstage") {
    return generateBackstage(graph, options);
  }
  return generateCrewAi(graph, options);
}

async function generateCrewAi(graph: OrgGraph, options: GenerateOptions): Promise<number> {
  if (options.team) {
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

async function generateBackstage(graph: OrgGraph, options: GenerateOptions): Promise<number> {
  const entities = options.team
    ? buildBackstageCatalog(graph, options.team).entities
    : buildBackstageOrgCatalog(graph);

  await fs.mkdir(options.out, { recursive: true });
  const file = path.join(options.out, "catalog-info.yaml");
  await fs.writeFile(file, toBackstageYaml(entities), "utf-8");
  console.log(`Wrote ${file} (${entities.length} entities)`);
  return 0;
}
