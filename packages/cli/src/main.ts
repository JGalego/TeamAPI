#!/usr/bin/env node
import { Command } from "commander";
import { runValidate } from "./commands/validate";
import { runRender } from "./commands/render";
import { runScaffold } from "./commands/scaffold";
import { runServeApi } from "./commands/serve-api";
import { runServeMcp } from "./commands/serve-mcp";

const program = new Command();
program.name("teamapi").description("Team API as Code toolchain CLI").version("0.1.0");

program
  .command("validate")
  .argument("<patterns...>", "file paths or globs to Team API documents")
  .description("Validate and resolve one or more Team API documents (and everything they $ref)")
  .action(async (patterns: string[]) => {
    process.exitCode = await runValidate(patterns);
  });

program
  .command("render")
  .argument("<patterns...>", "file paths or globs to Team API documents")
  .description("Render an organigram / role-hierarchy / context-map diagram")
  .requiredOption("--scope <scope>", "topology | hierarchy | context-map | org-hierarchy")
  .option("--format <format>", "mermaid | dot", "mermaid")
  .option("--team <id>", "scope to one team id")
  .option("--out <file>", "write to a file instead of stdout")
  .action(async (patterns: string[], opts: { scope: string; format: string; team?: string; out?: string }) => {
    process.exitCode = await runRender(patterns, {
      scope: opts.scope as "topology" | "hierarchy" | "context-map" | "org-hierarchy",
      format: opts.format as "mermaid" | "dot",
      team: opts.team,
      out: opts.out,
    });
  });

program
  .command("scaffold")
  .argument("<id>", "stable slug id for the new team")
  .description("Scaffold a new, minimal, schema-valid Team API document")
  .requiredOption("--type <type>", "stream-aligned | platform | complicated-subsystem | enabling")
  .option("--name <name>", "display name (defaults to the id)")
  .requiredOption("--out <file>", "output file path")
  .action(async (id: string, opts: { type: string; name?: string; out: string }) => {
    process.exitCode = await runScaffold({ id, type: opts.type, name: opts.name, out: opts.out });
  });

program
  .command("serve-api")
  .argument("<patterns...>", "file paths or globs to Team API documents")
  .description("Start the read-only REST API over the resolved org graph")
  .option("--port <port>", "port to listen on", "3000")
  .action(async (patterns: string[], opts: { port: string }) => {
    await runServeApi(patterns, { port: Number(opts.port) });
  });

program
  .command("serve-mcp")
  .argument("<patterns...>", "file paths or globs to Team API documents")
  .description("Start the MCP server (stdio transport) over the resolved org graph")
  .action(async (patterns: string[]) => {
    await runServeMcp(patterns);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
