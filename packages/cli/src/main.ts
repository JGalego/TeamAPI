#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { DEFAULT_CHAT_MODEL } from "@jgalego/teamapi-chat";
import { runValidate } from "./commands/validate";
import { runRender } from "./commands/render";
import { runScaffold } from "./commands/scaffold";
import { runGenerate } from "./commands/generate";
import { runServeApi } from "./commands/serve-api";
import { runServeMcp } from "./commands/serve-mcp";
import { runChat } from "./commands/chat";

// Read at runtime (not imported as a TS module) so this keeps working both from `dist/` in the
// monorepo and once installed from npm, without fighting `rootDir`/project-reference boundaries.
const packageVersion = (JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8")) as { version: string })
  .version;

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new InvalidArgumentError("must be an integer between 1 and 65535.");
  }
  return port;
}

const RENDER_SCOPES = ["topology", "hierarchy", "context-map", "org-hierarchy"] as const;
const RENDER_FORMATS = ["mermaid", "dot"] as const;
const TEAM_TYPES = ["stream-aligned", "platform", "complicated-subsystem", "enabling"] as const;

/** Builds a fresh, unparsed `Command` tree. Factored out (rather than module-level `parseAsync`
 * on import) so tests can construct an isolated instance, mock the `run*` command modules, and
 * exercise Commander's actual argument parsing/validation/defaults — the CLI's real entry point
 * below is just this plus `.parseAsync(process.argv)`. */
export function createProgram(): Command {
  const program = new Command();
  program.name("teamapi").description("Team API as Code toolchain CLI").version(packageVersion);

  program
    .command("validate")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Validate and resolve one or more Team API documents (and everything they $ref)")
    .action(async (patterns: string[]) => {
      process.exitCode = await runValidate(patterns);
    });

  const renderCommand = program
    .command("render")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Render an organigram / role-hierarchy / context-map diagram");
  renderCommand
    .addOption(
      renderCommand
        .createOption("--scope <scope>", "topology | hierarchy | context-map | org-hierarchy")
        .choices(RENDER_SCOPES)
        .makeOptionMandatory(),
    )
    .addOption(
      renderCommand.createOption("--format <format>", "mermaid | dot").choices(RENDER_FORMATS).default("mermaid"),
    )
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

  const scaffoldCommand = program
    .command("scaffold")
    .argument("<id>", "stable slug id for the new team")
    .description("Scaffold a new, minimal, schema-valid Team API document");
  scaffoldCommand
    .addOption(
      scaffoldCommand
        .createOption("--type <type>", "stream-aligned | platform | complicated-subsystem | enabling")
        .choices(TEAM_TYPES)
        .makeOptionMandatory(),
    )
    .option("--name <name>", "display name (defaults to the id)")
    .requiredOption("--out <file>", "output file path")
    .action(async (id: string, opts: { type: string; name?: string; out: string }) => {
      process.exitCode = await runScaffold({ id, type: opts.type, name: opts.name, out: opts.out });
    });

const GENERATE_TARGETS = ["crewai", "backstage"] as const;

const generateCommand = program
  .command("generate")
  .description("Generate config for an external tool from the resolved org graph")
  .option("--team <id>", "scope to one team id (single-crew/single-catalog output instead of the whole org)")
  .requiredOption("--out <dir>", "output directory");
generateCommand
  .addArgument(generateCommand.createArgument("<target>", "crewai | backstage").choices(GENERATE_TARGETS))
  .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
  .action(async (target: "crewai" | "backstage", patterns: string[], opts: { team?: string; out: string }) => {
    process.exitCode = await runGenerate(patterns, { target, team: opts.team, out: opts.out });
  });

  program
    .command("serve-api")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Start the read-only REST API over the resolved org graph")
    .option("--port <port>", "port to listen on", parsePort, 3000)
    .action(async (patterns: string[], opts: { port: number }) => {
      await runServeApi(patterns, { port: opts.port });
    });

  program
    .command("serve-mcp")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Start the MCP server (stdio transport) over the resolved org graph")
    .action(async (patterns: string[]) => {
      await runServeMcp(patterns);
    });

  program
    .command("chat")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description(
      "Chat as a team or a team member, backed by a live tool-use loop over the org graph (requires ANTHROPIC_API_KEY)",
    )
    .requiredOption("--team <id>", "team id to chat as")
    .option("--member <id>", "chat as a specific member on that team instead of the team as a whole")
    .option("--model <id>", "Anthropic model id", DEFAULT_CHAT_MODEL)
    .option("--debug", "print the persona's system prompt and every tool call")
    .action(async (patterns: string[], opts: { team: string; member?: string; model: string; debug?: boolean }) => {
      process.exitCode = await runChat(patterns, {
        team: opts.team,
        member: opts.member,
        model: opts.model,
        debug: opts.debug,
      });
    });

  return program;
}

/* c8 ignore start -- exercised via the built CLI binary, not unit tests */
if (require.main === module) {
  createProgram()
    .parseAsync(process.argv)
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
