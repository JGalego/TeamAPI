import { ConfigError, EMPTY_CONFIG, loadConfig, resolvePatterns, type TeamApiConfig } from "./config";

export interface ConfigAwareOptions {
  /** Path to a config file, instead of discovering one by walking up from the cwd. */
  config?: string;
  /** Ignore any config file entirely. */
  noConfig?: boolean;
}

export interface ResolvedInput {
  config: TeamApiConfig;
  sourcePath?: string;
  /** CLI patterns, or the config's when the command line gave none. */
  patterns: string[];
}

/**
 * Loads the config and resolves the patterns a command should operate on.
 *
 * Every command that takes patterns needs the same three steps in the same order — load, fall
 * back, fail cleanly on a bad config — and duplicating them is how they drift into three subtly
 * different behaviours. A `ConfigError` is returned rather than thrown so each command keeps
 * owning its own exit code and message stream.
 */
export async function resolveInput(
  cliPatterns: string[],
  options: ConfigAwareOptions = {},
): Promise<ResolvedInput | { error: string }> {
  if (options.noConfig) {
    return { config: EMPTY_CONFIG, patterns: cliPatterns };
  }

  try {
    const { config, sourcePath } = await loadConfig({ explicitPath: options.config });
    return { config, sourcePath, patterns: resolvePatterns(cliPatterns, config) };
  } catch (error) {
    if (error instanceof ConfigError) return { error: error.message };
    throw error;
  }
}

export function isConfigFailure(result: ResolvedInput | { error: string }): result is { error: string } {
  return "error" in result;
}

/**
 * The message for a command invoked with no patterns and no configured default.
 *
 * Names the config file explicitly, because "missing required argument" is true and useless once
 * the argument has become optional — the reader needs to know there are two ways to supply it.
 */
export const NO_PATTERNS_MESSAGE =
  "No patterns given. Pass file paths, globs, or a directory, or set `patterns:` in teamapi.config.yml.";
