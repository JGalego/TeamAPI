#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Argument, Command, InvalidArgumentError, Option } from "commander";
import { DEFAULT_CHAT_MODEL } from "@jgalego/teamapi-chat";
import { runValidate } from "./commands/validate";
import { REPORT_FORMATS, type ReportFormat } from "./report-format";
import { runGaps } from "./commands/gaps";
import { runShadowAi } from "./commands/shadow-ai";
import { runPolicy } from "./commands/policy";
import { runTopology } from "./commands/topology";
import { runRender } from "./commands/render";
import { runScaffold } from "./commands/scaffold";
import { runInit } from "./commands/init";
import { runFmt } from "./commands/fmt";
import { runMigrate } from "./commands/migrate";
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

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("must be a positive integer.");
  }
  return parsed;
}

/** The shared reporting-format option. Declared once so every command that produces findings
 * offers exactly the same spelling and the same choices — a `--format` that means one thing on
 * `gaps` and another on `policy` is worse than none. */
function reportFormatOption(command: Command): Option {
  return command.createOption("--format <format>", "text | json | sarif").choices(REPORT_FORMATS).default("text");
}

/**
 * Untangles Commander's `--config <file>` / `--no-config` pair, which it models as one key: a
 * string for the former and `false` for the latter. Declared once because reading `false` as a
 * filename is a mistake worth making zero times.
 */
function configFlags(opts: { config?: string | boolean }): { config?: string; noConfig: boolean } {
  return {
    config: typeof opts.config === "string" ? opts.config : undefined,
    noConfig: opts.config === false,
  };
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

  const validateCommand = program
    .command("validate")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Validate and resolve one or more Team API documents (and everything they $ref)");
  validateCommand
    .addOption(reportFormatOption(validateCommand))
    .option("--config <file>", "path to teamapi.config.yml")
    .option("--no-config", "ignore any config file")
    .action(async (patterns: string[], opts: { format: ReportFormat; config?: string | boolean }) => {
      process.exitCode = await runValidate(patterns, { format: opts.format, ...configFlags(opts) });
    });

  const gapsCommand = program
    .command("gaps")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Report accountability holes between teams — unowned event contracts, vacant seats, unowned agents");
  gapsCommand
    .addOption(reportFormatOption(gapsCommand))
    .option("--config <file>", "config file with severity overrides and waivers (default: nearest teamapi.config.yml)")
    .option("--no-config", "ignore any config file and report every finding at its declared severity")
    .action(async (patterns: string[], opts: { format: ReportFormat; config?: string | boolean }) => {
      // Commander models `--no-config` by setting the same `config` key to `false`, so the two
      // flags have to be untangled here rather than read as separate options.
      process.exitCode = await runGaps(patterns, { format: opts.format, ...configFlags(opts) });
    });

  const policyCommand = program
    .command("policy")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Check declared policies[] against the org graph, and report the ones nothing enforces");
  policyCommand
    .addOption(reportFormatOption(policyCommand))
    .option("--config <file>", "path to teamapi.config.yml")
    .option("--no-config", "ignore any config file")
    .action(async (patterns: string[], opts: { format: ReportFormat; config?: string | boolean }) => {
      process.exitCode = await runPolicy(patterns, { format: opts.format, ...configFlags(opts) });
    });

  const topologyCommand = program
    .command("topology")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Report Team Topologies design smells — overrunning collaborations, oversized teams, inverted flow");
  topologyCommand
    .addOption(reportFormatOption(topologyCommand))
    .option("--config <file>", "config file with thresholds and severity overrides")
    .option("--no-config", "ignore any config file and use the default thresholds")
    .action(async (patterns: string[], opts: { format: ReportFormat; config?: string | boolean }) => {
      process.exitCode = await runTopology(patterns, { format: opts.format, ...configFlags(opts) });
    });

  const shadowAiCommand = program
    .command("shadow-ai")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Report AI adoption found in repositories against what teams declare in agents[] (read-only)")
    .requiredOption("--scan <dir>", "directory whose immediate subdirectories are repository checkouts");
  shadowAiCommand
    .addOption(reportFormatOption(shadowAiCommand))
    .option("--config <file>", "path to teamapi.config.yml")
    .option("--no-config", "ignore any config file")
    .action(async (patterns: string[], opts: { scan: string; format: ReportFormat; config?: string | boolean }) => {
      process.exitCode = await runShadowAi(patterns, { scan: opts.scan, format: opts.format, ...configFlags(opts) });
    });

  const renderCommand = program
    .command("render")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
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

  program
    .command("init")
    .description("Scaffold a new org repository: config, CI workflow, editor settings, and first teams")
    .argument("[dir]", "directory to initialise", ".")
    .option("--teams-dir <dir>", "directory the team documents live in", "teams")
    .option("--team <id...>", "team ids to scaffold (default: one stream-aligned, one platform)")
    .option("--force", "overwrite files that already exist")
    .action(async (dir: string, opts: { teamsDir: string; team?: string[]; force?: boolean }) => {
      process.exitCode = await runInit({ dir, teamsDir: opts.teamsDir, teams: opts.team, force: opts.force });
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

  const fmtCommand = program
    .command("fmt")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Rewrite Team API documents into canonical form")
    .option("--check", "report which files would change and exit non-zero, without writing");
  fmtCommand
    .option("--config <file>", "path to teamapi.config.yml")
    .option("--no-config", "ignore any config file")
    .action(async (patterns: string[], opts: { check?: boolean; config?: string | boolean }) => {
      process.exitCode = await runFmt(patterns, { check: opts.check, ...configFlags(opts) });
    });

  const migrateCommand = program
    .command("migrate")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Bring documents up to the latest teamApiVersion, and explain the ones that cannot be")
    .option("--check", "report what would change and exit non-zero, without writing");
  migrateCommand
    .option("--config <file>", "path to teamapi.config.yml")
    .option("--no-config", "ignore any config file")
    .action(async (patterns: string[], opts: { check?: boolean; config?: string | boolean }) => {
      process.exitCode = await runMigrate(patterns, { check: opts.check, ...configFlags(opts) });
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
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
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
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Diff the resolved org graph against a git revision (requires running inside a git repository)")
    .requiredOption("--against <ref>", "git revision to diff against, e.g. HEAD, main, a tag, or a commit sha")
    .addOption(new Option("--format <format>", "text | json").choices(["text", "json"]).default("text"))
    .action(async (patterns: string[], opts: { against: string; format: "text" | "json" }) => {
      process.exitCode = await runDiff(patterns, { against: opts.against, format: opts.format });
    });

  program
    .command("apply")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Reconcile GitHub teams/memberships with the resolved org graph (prints a plan; --yes to execute it)")
    .option("--org <org>", "GitHub organization login to reconcile (defaults to defaults.github.org)")
    .option("--token <token>", "GitHub token (defaults to GITHUB_TOKEN/GH_TOKEN env var)")
    .option("--yes", "execute the plan instead of just printing it")
    .action(async (patterns: string[], opts: { org?: string; token?: string; yes?: boolean }) => {
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
    .option("--url <url>", "Okta org URL, e.g. https://acme.okta.com (defaults to defaults.okta.url)")
    .option("--token <token>", "Okta API token (defaults to OKTA_TOKEN)")
    .option("--group-prefix <prefix>", "strip this prefix from group names before matching team ids")
    .action(async (patterns: string[], opts: { url?: string; token?: string; groupPrefix?: string }) => {
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
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Report drift between the org graph and a running Paperclip company (read-only)")
    .option("--url <url>", "Paperclip base URL (defaults to defaults.paperclip.url)")
    .option("--company <id>", "Paperclip company id (defaults to defaults.paperclip.company)")
    .option("--token <token>", "Paperclip token (defaults to PAPERCLIP_API_KEY env var)")
    .action(async (patterns: string[], opts: { url?: string; company?: string; token?: string }) => {
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
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Start the read-only REST API over the resolved org graph")
    .option("--port <port>", "port to listen on", parsePort, 3000)
    .option("--host <host>", "address to bind (non-loopback requires --token or --allow-anonymous)", "127.0.0.1")
    .option("--token <token>", "require this bearer token on every request (defaults to TEAMAPI_API_TOKEN)")
    .option("--cors-origin <origin...>", "allow cross-origin browser requests from these origins")
    .option("--rate-limit <per-minute>", "max requests per minute per client IP", parsePositiveInt)
    .option("--allow-anonymous", "serve a non-loopback address with no token (this exposes the org graph)")
    .option("--watch", "re-resolve the graph when a team document changes")
    .option("--reload-endpoint", "mount POST /reload without watching the filesystem")
    .option("--mcp", "also serve MCP over Streamable HTTP at POST /mcp")
    .option("--config <file>", "path to teamapi.config.yml")
    .option("--no-config", "ignore any config file")
    .action(
      async (
        patterns: string[],
        opts: {
          port: number;
          host: string;
          token?: string;
          corsOrigin?: string[];
          rateLimit?: number;
          allowAnonymous?: boolean;
          watch?: boolean;
          reloadEndpoint?: boolean;
          mcp?: boolean;
          config?: string | boolean;
        },
      ) => {
        await runServeApi(patterns, {
          port: opts.port,
          host: opts.host,
          token: opts.token,
          corsOrigin: opts.corsOrigin,
          rateLimit: opts.rateLimit,
          allowAnonymous: opts.allowAnonymous,
          watch: opts.watch,
          reloadEndpoint: opts.reloadEndpoint,
          mcp: opts.mcp,
          ...configFlags(opts),
        });
      },
    );

  program
    .command("serve-mcp")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
    .description("Start the MCP server (stdio transport) over the resolved org graph")
    .option("--watch", "re-resolve the graph when a team document changes")
    .option("--config <file>", "path to teamapi.config.yml")
    .option("--no-config", "ignore any config file")
    .action(async (patterns: string[], opts: { watch?: boolean; config?: string | boolean }) => {
      await runServeMcp(patterns, { watch: opts.watch, ...configFlags(opts) });
    });

  program
    .command("chat")
    .argument("[patterns...]", "file paths, globs, or a directory (defaults to `patterns:` in teamapi.config.yml)")
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
