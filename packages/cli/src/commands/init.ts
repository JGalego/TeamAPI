import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { TEAM_API_SCHEMA_MODELINE, TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { formatZodError } from "@jgalego/teamapi-core";

export interface InitOptions {
  /** Directory to initialise. Created if missing. */
  dir: string;
  /** Directory under `dir` that team documents live in. */
  teamsDir?: string;
  /** Team ids to scaffold. */
  teams?: string[];
  /** Overwrite files that already exist. */
  force?: boolean;
}

interface GeneratedFile {
  relativePath: string;
  content: string;
}

const DEFAULT_TEAMS_DIR = "teams";

/**
 * A team document, generated the same way `teamapi scaffold` generates one — the modeline first,
 * then the YAML — so a repo initialised here and a team added later look identical.
 */
function teamDocument(id: string, type: string): string {
  const doc = {
    teamApiVersion: "1.0.0",
    id,
    info: {
      name: id
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
      type,
      focus: "TODO: describe this team's focus",
    },
    channels: [],
    searchTerms: [],
    services: [],
    roles: [],
    members: [],
    meetings: [],
    interactions: [],
    dependencies: [],
  };

  const parsed = TeamApiDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(`Could not scaffold '${id}': ${formatZodError(parsed.error)}`);
  }
  return `${TEAM_API_SCHEMA_MODELINE}\n${YAML.dump(doc, { noRefs: true })}`;
}

/**
 * The config file, written with the settings that are worth having from day one and nothing else.
 *
 * `patterns` is the whole reason this file exists at startup rather than being added later: with
 * it, every command in the repo works with no arguments, which is the difference between a
 * toolchain people run and one they look up the invocation for each time.
 */
function configFile(teamsDir: string): string {
  return `# Team API toolchain configuration.
# Docs: https://github.com/JGalego/TeamAPI#config

# Where this org's team documents live, so every command works with no arguments.
patterns:
  - ${teamsDir}

# Flags that are constant for this org. Never put tokens here — this file is committed, and
# every command reads its token from an environment variable instead.
defaults: {}
# defaults:
#   github:
#     org: your-github-org

# Severity overrides and expiring waivers for \`teamapi gaps\`.
gaps:
  severity: {}
  waivers: []

# Thresholds for \`teamapi topology\`.
topology:
  maxTeamSize: 9
  maxCollaborations: 3
`;
}

/**
 * CI wired to the checks that are safe to gate on from an org's first day.
 *
 * `check-gaps` is deliberately off. A new org has no gaps, but the first time this repo describes
 * a real one it will, and a workflow that turned red on the day the documents became honest is a
 * workflow that gets deleted. Turning it on is a decision to make once there is something to gate.
 */
function workflow(teamsDir: string): string {
  return `name: Team API

on:
  pull_request:
    paths: ["${teamsDir}/**"]
  push:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: JGalego/TeamAPI/.github/actions/validate@main
        with:
          patterns: ${teamsDir}
          render-scope: topology
          # Turn these on once the org has something worth gating on:
          # check-gaps: "true"
          # check-policies: "true"
          # check-topology: "true"
`;
}

/** VS Code settings binding the documents to the published schema, for editors that don't read
 * the per-file modeline. Both mechanisms point at the same schema; whichever the editor honours,
 * the author gets completion. */
function vscodeSettings(teamsDir: string): string {
  return `${JSON.stringify(
    {
      "yaml.schemas": {
        "https://teamapi.dev/schema/v1.json": [`${teamsDir}/**/teamapi.yml`, `${teamsDir}/**/teamapi.yaml`],
      },
    },
    null,
    2,
  )}\n`;
}

function readme(teamsDir: string, teams: string[]): string {
  return `# Org

This repository describes how this organization is put together — one \`teamapi.yml\` per team,
reviewed in pull requests and versioned in git.

## Teams

${teams.map((id) => `- \`${teamsDir}/${id}/teamapi.yml\``).join("\n")}

## Working with it

\`\`\`bash
npm install -g @jgalego/teamapi

teamapi validate          # resolve every $ref, report conflicts
teamapi gaps              # what is nobody accountable for
teamapi topology          # Team Topologies design smells
teamapi render --scope topology
teamapi serve-api         # REST API + dashboard on http://127.0.0.1:3000
\`\`\`

None of these need arguments: \`patterns:\` in \`teamapi.config.yml\` says where the documents are.

## Adding a team

\`\`\`bash
teamapi scaffold my-team --type stream-aligned --out ${teamsDir}/my-team/teamapi.yml
\`\`\`
`;
}

export function generateInitFiles(options: InitOptions): GeneratedFile[] {
  const teamsDir = options.teamsDir ?? DEFAULT_TEAMS_DIR;
  const teams = options.teams?.length ? options.teams : ["stream-example", "platform-example"];

  return [
    { relativePath: "teamapi.config.yml", content: configFile(teamsDir) },
    { relativePath: path.join(".github", "workflows", "teamapi.yml"), content: workflow(teamsDir) },
    { relativePath: path.join(".vscode", "settings.json"), content: vscodeSettings(teamsDir) },
    { relativePath: "README.md", content: readme(teamsDir, teams) },
    ...teams.map((id) => ({
      relativePath: path.join(teamsDir, id, "teamapi.yml"),
      // Everything after the first is a platform team, so the generated org has at least one of
      // each and its first `render --scope topology` shows something with a shape.
      content: teamDocument(id, id.startsWith("platform") ? "platform" : "stream-aligned"),
    })),
  ];
}

/**
 * Scaffolds a whole org repository, not a single document.
 *
 * `scaffold` produces one team and leaves every other decision open — where documents live, how
 * CI runs them, how an editor validates them — which is the work that actually stands between
 * somebody trying this and somebody using it. This makes those decisions, in a way each command's
 * defaults already agree with.
 *
 * Refuses to overwrite by default, and names every file it would have replaced rather than
 * stopping at the first: being told one at a time that a directory isn't empty is worse than
 * being told what is in it.
 */
export async function runInit(options: InitOptions): Promise<number> {
  const root = path.resolve(options.dir);
  let files: GeneratedFile[];
  try {
    files = generateInitFiles(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (!options.force) {
    const existing: string[] = [];
    for (const file of files) {
      try {
        await fs.access(path.join(root, file.relativePath));
        existing.push(file.relativePath);
      } catch {
        // absent, which is what we want
      }
    }
    if (existing.length > 0) {
      console.error(`Refusing to overwrite ${existing.length} existing file(s):`);
      for (const relativePath of existing) console.error(`  - ${relativePath}`);
      console.error("Pass --force to overwrite them.");
      return 1;
    }
  }

  for (const file of files) {
    const target = path.join(root, file.relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content, "utf-8");
    console.log(`  + ${file.relativePath}`);
  }

  console.log(`\nInitialised ${files.length} file(s) in ${root}.`);
  console.log("Next: `teamapi validate` — it needs no arguments, teamapi.config.yml says where to look.");
  return 0;
}
