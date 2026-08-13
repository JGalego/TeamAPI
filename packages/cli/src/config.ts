import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { z } from "zod";
import { GapRulesConfigSchema, isGapKind, type GapRulesConfig } from "@jgalego/teamapi-core";

export const CONFIG_FILENAMES = ["teamapi.config.yml", "teamapi.config.yaml"] as const;

/**
 * The project configuration file.
 *
 * `.strict()` throughout, and deliberately: a mistyped key in a config that silently does nothing
 * is worse than no config at all, because the org believes a rule is in force when it isn't. A
 * `waviers:` typo has to be an error, not a shrug.
 */
export const TeamApiConfigSchema = z
  .object({
    gaps: GapRulesConfigSchema.default({ severity: {}, waivers: [] }),
  })
  .strict();
export type TeamApiConfig = z.infer<typeof TeamApiConfigSchema>;

export const EMPTY_CONFIG: TeamApiConfig = { gaps: { severity: {}, waivers: [] } };

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
  return { config: parsed.data, sourcePath };
}
