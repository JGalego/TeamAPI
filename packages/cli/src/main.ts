#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Argument, Command, InvalidArgumentError } from "commander";
import { DEFAULT_CHAT_MODEL } from "@jgalego/teamapi-chat";
import { runValidate } from "./commands/validate";
import { runGaps } from "./commands/gaps";
import { runShadowAi } from "./commands/shadow-ai";
import { runRender } from "./commands/render";
import { runScaffold } from "./commands/scaffold";
import { runSchema } from "./commands/schema";
import { runGenerate } from "./commands/generate";
import { runDiff } from "./commands/diff";
import { runApply } from "./commands/apply";
import { runSlackSync } from "./commands/slack-sync";
import { runPagerDutyDrift } from "./commands/pagerduty-drift";
import { runOktaDrift } from "./commands/okta-drift";
import { runDoctor, type DoctorIntegration } from "./commands/doctor";
import { runPaperclipDrift } from "./commands/paperclip-drift";
import { runImport, type ImportSource } from "./commands/import";
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

  program
    .command("gaps")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Report accountability holes between teams — unowned event contracts, vacant seats, unowned agents")
    .action(async (patterns: string[]) => {
      process.exitCode = await runGaps(patterns);
    });

  program
    .command("shadow-ai")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Report AI adoption found in repositories against what teams declare in agents[] (read-only)")
    .requiredOption("--scan <dir>", "directory whose immediate subdirectories are repository checkouts")
    .action(async (patterns: string[], opts: { scan: string }) => {
      process.exitCode = await runShadowAi(patterns, { scan: opts.scan });
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
    .option("--with-agents", "org-hierarchy only: draw declared agents attached to the humans who own them")
    .action(
      async (
        patterns: string[],
        opts: { scope: string; format: string; team?: string; out?: string; withAgents?: boolean },
      ) => {
        process.exitCode = await runRender(patterns, {
          scope: opts.scope as "topology" | "hierarchy" | "context-map" | "org-hierarchy",
          format: opts.format as "mermaid" | "dot",
          team: opts.team,
          out: opts.out,
          withAgents: opts.withAgents,
        });
      },
    );

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

  program
    .command("schema")
    .description("Print the JSON Schema for the Team API document format (for editors and CI)")
    .option("--out <file>", "write to a file instead of stdout")
    .action(async (opts: { out?: string }) => {
      process.exitCode = await runSchema({ out: opts.out });
    });

  const GENERATE_TARGETS = ["crewai", "backstage", "paperclip", "codeowners", "agents-md", "port", "otel"] as const;

  const generateCommand = program
    .command("generate")
    .description("Generate config for an external tool from the resolved org graph")
    .option("--team <id>", "scope to one team id (single-crew/single-catalog output instead of the whole org)")
    .requiredOption("--out <dir>", "output directory");
  generateCommand
    .addArgument(
      generateCommand
        .createArgument("<target>", "crewai | backstage | paperclip | codeowners | agents-md | port | otel")
        .choices(GENERATE_TARGETS),
    )
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .option("--company <name>", 'company name for the paperclip target (default: "Agent Company")')
    .option("--org <org>", "GitHub org for the codeowners target, so owners read @org/team-id")
    .action(
      async (
        target: "crewai" | "backstage" | "paperclip" | "codeowners" | "agents-md" | "port" | "otel",
        patterns: string[],
        opts: { team?: string; out: string; company?: string; org?: string },
      ) => {
        process.exitCode = await runGenerate(patterns, {
          target,
          team: opts.team,
          out: opts.out,
          company: opts.company,
          org: opts.org,
        });
      },
    );

  program
    .command("diff")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Diff the resolved org graph against a git revision (requires running inside a git repository)")
    .requiredOption("--against <ref>", "git revision to diff against, e.g. HEAD, main, a tag, or a commit sha")
    .action(async (patterns: string[], opts: { against: string }) => {
      process.exitCode = await runDiff(patterns, { against: opts.against });
    });

  program
    .command("apply")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Reconcile GitHub teams/memberships with the resolved org graph (prints a plan; --yes to execute it)")
    .requiredOption("--org <org>", "GitHub organization login to reconcile")
    .option("--token <token>", "GitHub token (defaults to GITHUB_TOKEN/GH_TOKEN env var)")
    .option("--yes", "execute the plan instead of just printing it")
    .action(async (patterns: string[], opts: { org: string; token?: string; yes?: boolean }) => {
      process.exitCode = await runApply(patterns, { org: opts.org, token: opts.token, yes: opts.yes });
    });

  const DOCTOR_INTEGRATIONS = ["github", "slack", "pagerduty", "okta", "paperclip"] as const;
  program
    .command("doctor")
    .description("Check a live integration: authentication, the read, field shapes, and pagination")
    .addArgument(
      new Argument("<integration>", "github | slack | pagerduty | okta | paperclip").choices(DOCTOR_INTEGRATIONS),
    )
    .option("--token <token>", "API token (defaults to the provider's usual environment variable)")
    .option("--url <url>", "API base URL; required for okta (your org URL)")
    .option("--org <org>", "organization login; required for github")
    .option("--company <id>", "company id; required for paperclip")
    .action(
      async (
        integration: DoctorIntegration,
        opts: { token?: string; url?: string; org?: string; company?: string },
      ) => {
        process.exitCode = await runDoctor(integration, {
          token: opts.token,
          url: opts.url,
          org: opts.org,
          company: opts.company,
        });
      },
    );

  program
    .command("slack-sync")
    .description("Set each declared Slack channel's topic to name the team that owns it")
    .argument("<patterns...>", "teamapi.yml paths or globs")
    .option("--token <token>", "Slack bot token (defaults to SLACK_BOT_TOKEN)")
    .option("--yes", "apply the plan instead of only printing it")
    .action(async (patterns: string[], opts: { token?: string; yes?: boolean }) => {
      process.exitCode = await runSlackSync(patterns, { token: opts.token, yes: opts.yes });
    });

  program
    .command("okta-drift")
    .description("Report where declared members and an Okta directory group disagree (read-only)")
    .argument("<patterns...>", "teamapi.yml paths or globs")
    .requiredOption("--url <url>", "Okta org URL, e.g. https://acme.okta.com")
    .option("--token <token>", "Okta API token (defaults to OKTA_TOKEN)")
    .option("--group-prefix <prefix>", "strip this prefix from group names before matching team ids")
    .action(async (patterns: string[], opts: { url: string; token?: string; groupPrefix?: string }) => {
      process.exitCode = await runOktaDrift(patterns, {
        url: opts.url,
        token: opts.token,
        groupPrefix: opts.groupPrefix,
      });
    });

  program
    .command("pagerduty-drift")
    .description("Report where PagerDuty and the org graph disagree about who gets paged (read-only)")
    .argument("<patterns...>", "teamapi.yml paths or globs")
    .option("--token <token>", "PagerDuty REST API token (defaults to PAGERDUTY_TOKEN)")
    .option("--url <url>", "API base URL (defaults to https://api.pagerduty.com)")
    .action(async (patterns: string[], opts: { token?: string; url?: string }) => {
      process.exitCode = await runPagerDutyDrift(patterns, { token: opts.token, url: opts.url });
    });

  program
    .command("paperclip-drift")
    .argument("<patterns...>", "file paths, globs, or a directory to auto-discover teamapi.yml under it")
    .description("Report drift between the org graph and a running Paperclip company (read-only)")
    .requiredOption("--url <url>", "Paperclip base URL, e.g. http://localhost:3000")
    .requiredOption("--company <id>", "Paperclip company id to check")
    .option("--token <token>", "Paperclip token (defaults to PAPERCLIP_API_KEY env var)")
    .action(async (patterns: string[], opts: { url: string; company: string; token?: string }) => {
      process.exitCode = await runPaperclipDrift(patterns, opts);
    });

  const IMPORT_SOURCES = ["github-org"] as const;
  const importCommand = program
    .command("import")
    .description("Bootstrap Team API document(s) from an existing system")
    .option("--token <token>", "GitHub token (defaults to GITHUB_TOKEN/GH_TOKEN env var)")
    .requiredOption("--out <dir>", "output directory, one <team-id>/teamapi.yml per team");
  importCommand
    .addArgument(importCommand.createArgument("<source>", "github-org").choices(IMPORT_SOURCES))
    .argument("<org>", "GitHub organization login to import teams from")
    .action(async (source: ImportSource, org: string, opts: { token?: string; out: string }) => {
      process.exitCode = await runImport(source, org, { token: opts.token, out: opts.out });
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
