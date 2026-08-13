import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { z } from "zod";
import {
  GapRulesConfigSchema,
  isGapKind,
  isTopologyKind,
  TopologyConfigSchema,
  type GapRulesConfig,
  type TopologyConfig,
} from "@jgalego/teamapi-core";

export const CONFIG_FILENAMES = ["teamapi.config.yml", "teamapi.config.yaml"] as const;

/**
 * Per-command option defaults.
 *
 * **No credentials.** There is deliberately no `token` anywhere in this schema, and there won't
 * be: this file lives in the repository, and the single most common way a secret is leaked is a
 * config format that made somewhere convenient to put one. Every command already reads its token
 * from an environment variable, which is the right place, so the omission costs nothing.
 *
 * These are the flags that are constant for an org — its GitHub login, its Okta URL — and which
 * are therefore retyped on every single invocation until something remembers them.
 */
const DefaultsSchema = z
  .object({
    github: z
      .object({ org: z.string().min(1).optional() })
      .strict()
      .default({}),
    okta: z
      .object({ url: z.string().min(1).optional(), groupPrefix: z.string().min(1).optional() })
      .strict()
      .default({}),
    pagerduty: z
      .object({ url: z.string().min(1).optional() })
      .strict()
      .default({}),
    paperclip: z
      .object({ url: z.string().min(1).optional(), company: z.string().min(1).optional() })
      .strict()
      .default({}),
    serve: z
      .object({
        port: z.number().int().min(1).max(65535).optional(),
        host: z.string().min(1).optional(),
        corsOrigin: z.array(z.string().min(1)).optional(),
        rateLimit: z.number().int().positive().optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type Defaults = z.infer<typeof DefaultsSchema>;

/**
 * The project configuration file.
 *
 * `.strict()` throughout, and deliberately: a mistyped key in a config that silently does nothing
 * is worse than no config at all, because the org believes a rule is in force when it isn't. A
 * `waviers:` typo has to be an error, not a shrug.
 */
export const TeamApiConfigSchema = z
  .object({
    /**
     * Seed patterns to use when the command line gives none. This is the setting that turns
     * `teamapi gaps path/to/org` into a bare `teamapi gaps`, and it matters most for the commands
     * people run dozens of times a day.
     */
    patterns: z.array(z.string().min(1)).default([]),
    defaults: DefaultsSchema.default({}),
    gaps: GapRulesConfigSchema.default({ severity: {}, waivers: [] }),
    topology: TopologyConfigSchema.default({ maxTeamSize: 9, maxCollaborations: 3, severity: {} }),
  })
  .strict();
export type TeamApiConfig = z.infer<typeof TeamApiConfigSchema>;

const EMPTY_DEFAULTS: Defaults = { github: {}, okta: {}, pagerduty: {}, paperclip: {}, serve: {} };

export const EMPTY_CONFIG: TeamApiConfig = {
  patterns: [],
  defaults: EMPTY_DEFAULTS,
  gaps: { severity: {}, waivers: [] },
  topology: { maxTeamSize: 9, maxCollaborations: 3, severity: {} },
};

/**
 * Patterns from the command line, falling back to the config file's.
 *
 * Fallback rather than merge: a command line that names patterns is being explicit about scope,
 * and quietly adding the org's default set to it would resolve teams the caller did not ask about.
 */
export function resolvePatterns(cliPatterns: string[], config: TeamApiConfig): string[] {
  return cliPatterns.length > 0 ? cliPatterns : config.patterns;
}

export interface LoadedConfig {
  config: TeamApiConfig;
  /** Where it came from, for error messages. `undefined` when no file was found. */
  sourcePath?: string;
}

/**
 * Walks up from `startDir` looking for a config file, the way git finds `.git` and every other
 * tool finds its rc file.
 *
 * Upward rather than cwd-only because commands are run from wherever is convenient — a repo root,
 * a team's own directory, a CI working directory one level down — and a config that only applies
 * when you happen to stand in the right place is a config people stop trusting.
 */
export async function findConfigFile(startDir: string): Promise<string | undefined> {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = path.join(dir, filename);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // keep looking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export class ConfigError extends Error {}

function checkGapKinds(gaps: GapRulesConfig, sourcePath: string): void {
  // A severity override or waiver naming a kind that doesn't exist does nothing at all, and looks
  // exactly like one that works. Almost always a typo or a renamed rule.
  const unknown = [
    ...Object.keys(gaps.severity).filter((kind) => !isGapKind(kind)),
    ...gaps.waivers.map((waiver) => waiver.kind).filter((kind) => !isGapKind(kind)),
  ];
  if (unknown.length > 0) {
    throw new ConfigError(`${sourcePath}: unknown gap kind(s): ${[...new Set(unknown)].sort().join(", ")}`);
  }
}

function checkTopologyKinds(topology: TopologyConfig, sourcePath: string): void {
  const unknown = Object.keys(topology.severity).filter((kind) => !isTopologyKind(kind));
  if (unknown.length > 0) {
    throw new ConfigError(`${sourcePath}: unknown topology kind(s): ${[...new Set(unknown)].sort().join(", ")}`);
  }
}

export async function loadConfig(options: { explicitPath?: string; cwd?: string } = {}): Promise<LoadedConfig> {
  const sourcePath = options.explicitPath
    ? path.resolve(options.explicitPath)
    : await findConfigFile(options.cwd ?? process.cwd());

  if (!sourcePath) return { config: EMPTY_CONFIG };

  let text: string;
  try {
    text = await fs.readFile(sourcePath, "utf-8");
  } catch (error) {
    // An explicitly named config that cannot be read is an error; a discovered one can't hit this.
    throw new ConfigError(`Could not read ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let raw: unknown;
  try {
    raw = YAML.load(text);
  } catch (error) {
    throw new ConfigError(`${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = TeamApiConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`${sourcePath}: ${detail}`);
  }

  checkGapKinds(parsed.data.gaps, sourcePath);
  checkTopologyKinds(parsed.data.topology, sourcePath);
  return { config: parsed.data, sourcePath };
}
