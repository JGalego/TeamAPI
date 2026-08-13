import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getTeamApiJsonSchema } from "@jgalego/teamapi-schema";

export interface SchemaOptions {
  /** Write to this file instead of stdout. Parent directories are created if missing. */
  out?: string;
}

/**
 * Prints (or writes) the JSON Schema for the Team API document format.
 *
 * This is the mechanism that keeps the published schema honest: `site/schema/v1.json` is written
 * by this command rather than maintained by hand, and a test regenerates it and fails when the
 * committed copy has drifted from the Zod schemas it is derived from.
 */
export async function runSchema(options: SchemaOptions = {}): Promise<number> {
  // Trailing newline so the file is POSIX-clean and Prettier-stable; `JSON.stringify` alone
  // produces a no-final-newline file that `format:check` would reject.
  const json = `${JSON.stringify(getTeamApiJsonSchema(), null, 2)}\n`;

  if (!options.out) {
    process.stdout.write(json);
    return 0;
  }

  await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await fs.writeFile(options.out, json, "utf-8");
  console.log(`Wrote ${options.out}`);
  return 0;
}
