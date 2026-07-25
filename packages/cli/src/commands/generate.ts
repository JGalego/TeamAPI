import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildBackstageCatalog,
  buildBackstageOrgCatalog,
  buildCrewAiCrewConfig,
  buildCrewAiOrgConfig,
  buildOrgGraph,
  buildPaperclipPackage,
  toBackstageYaml,
  toCrewAiCrewYaml,
  toCrewAiOrgYaml,
  type OrgGraph,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface GenerateOptions {
  target: "crewai" | "backstage" | "paperclip";
  team?: string;
  out: string;
  company?: string;
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

  if (options.target === "paperclip") {
    return generatePaperclip(graph, options);
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

/** Writes an Agent Companies (`agentcompanies/v1`) package — a tree of markdown files, so each
 * one is created relative to `--out` with its parent directories. */
async function generatePaperclip(graph: OrgGraph, options: GenerateOptions): Promise<number> {
  const pkg = buildPaperclipPackage(graph, { name: options.company ?? "Agent Company" });
  for (const file of pkg.files) {
    const target = path.join(options.out, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
  }
  console.log(`Wrote ${pkg.files.length} file(s) to ${options.out}/ (agentcompanies/v1)`);
  if (pkg.skippedAgents.length > 0) {
    console.log(
      `  ! skipped ${pkg.skippedAgents.length} non-active agent(s): ${pkg.skippedAgents.join(", ")}`,
    );
  }
  return 0;
}
