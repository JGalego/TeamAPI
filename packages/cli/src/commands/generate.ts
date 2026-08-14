import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildBackstageCatalog,
  buildBackstageOrgCatalog,
  buildCrewAiCrewConfig,
  buildAgentsMd,
  buildCodeowners,
  buildCrewAiOrgConfig,
  buildOrgGraph,
  buildOtelPackage,
  buildPortCatalog,
  buildPaperclipPackage,
  toBackstageYaml,
  toCrewAiCrewYaml,
  toCrewAiOrgYaml,
  type OrgGraph,
} from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface GenerateOptions {
  target: "crewai" | "backstage" | "paperclip" | "codeowners" | "agents-md" | "port" | "otel";
  team?: string;
  out: string;
  company?: string;
  org?: string;
}

export async function runGenerate(patterns: string[], options: GenerateOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph(resolveOptions(seeds));
  warnUnresolved(graph);

  if (options.team && !graph.teams.has(options.team)) {
    console.error(`Unknown team id: ${options.team}`);
    return 1;
  }

  if (options.target === "otel") {
    return generateOtel(graph, options);
  }
  if (options.target === "port") {
    return generatePort(graph, options);
  }
  if (options.target === "agents-md") {
    return generateAgentsMd(graph, options);
  }
  if (options.target === "codeowners") {
    return generateCodeowners(graph, options);
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
  const entities = options.team ? buildBackstageCatalog(graph, options.team).entities : buildBackstageOrgCatalog(graph);

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
    console.log(`  ! skipped ${pkg.skippedAgents.length} non-active agent(s): ${pkg.skippedAgents.join(", ")}`);
  }
  return 0;
}

/** Writes one CODEOWNERS per repository, under `--out/<owner>/<repo>/CODEOWNERS` so the output
 * mirrors where each file belongs. Exits non-zero on a conflict: a repository claimed by two
 * teams has no correct CODEOWNERS, and silently picking one would paper over a real question. */
async function generateCodeowners(graph: OrgGraph, options: GenerateOptions): Promise<number> {
  const pkg = buildCodeowners(graph, { org: options.org });
  for (const file of pkg.files) {
    const target = path.join(options.out, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
  }
  console.log(`Wrote ${pkg.files.length} CODEOWNERS file(s) to ${options.out}/`);
  for (const skip of pkg.skipped) {
    console.log(`  - skipped ${skip.teamId}/${skip.service}: ${skip.reason}`);
  }
  for (const conflict of pkg.conflicts) {
    console.error(`  ! ${conflict.repo} is claimed by ${conflict.teamIds.join(" and ")} — no CODEOWNERS written`);
  }
  return pkg.conflicts.length > 0 ? 1 : 0;
}

/** Writes one AGENTS.md per repository, under `--out/<owner>/<repo>/AGENTS.md`. Same conflict
 * rule as the codeowners target: two teams' policies rendered into one file would read as one
 * team's, so a shared repo gets nothing and the command exits non-zero. */
async function generateAgentsMd(graph: OrgGraph, options: GenerateOptions): Promise<number> {
  const pkg = buildAgentsMd(graph);
  for (const file of pkg.files) {
    const target = path.join(options.out, file.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf8");
  }
  console.log(`Wrote ${pkg.files.length} AGENTS.md file(s) to ${options.out}/`);
  for (const skip of pkg.skipped) {
    console.log(`  - skipped ${skip.teamId}/${skip.service}: ${skip.reason}`);
  }
  for (const conflict of pkg.conflicts) {
    console.error(`  ! ${conflict.repo} is claimed by ${conflict.teamIds.join(" and ")} — no AGENTS.md written`);
  }
  return pkg.conflicts.length > 0 ? 1 : 0;
}

/** Writes Port's two halves separately: `blueprints.json` is applied once, `entities.json` on
 * every change, and the two go to different API endpoints. */
async function generatePort(graph: OrgGraph, options: GenerateOptions): Promise<number> {
  const catalog = buildPortCatalog(graph, options.team);
  await fs.mkdir(options.out, { recursive: true });
  await fs.writeFile(
    path.join(options.out, "blueprints.json"),
    `${JSON.stringify(catalog.blueprints, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(options.out, "entities.json"), `${JSON.stringify(catalog.entities, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${catalog.blueprints.length} blueprint(s) and ${catalog.entities.length} entity(ies) to ${options.out}/`,
  );
  return 0;
}

/** Writes one `.env` per service plus a collector config. Both, because which one you can land
 * depends on whether you own the deployments or the collector. */
async function generateOtel(graph: OrgGraph, options: GenerateOptions): Promise<number> {
  const pkg = buildOtelPackage(graph);
  await fs.mkdir(options.out, { recursive: true });
  for (const file of pkg.files) {
    await fs.writeFile(path.join(options.out, file.path), file.content, "utf8");
  }
  console.log(`Wrote attributes for ${pkg.services.length} service(s) to ${options.out}/`);
  return 0;
}
