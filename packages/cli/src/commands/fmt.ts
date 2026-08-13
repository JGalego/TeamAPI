import * as fs from "node:fs/promises";
import * as path from "node:path";
import { formatDocumentText } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface FmtOptions extends ConfigAwareOptions {
  /** Report which files would change and exit non-zero, without writing anything. */
  check?: boolean;
}

/**
 * Rewrites Team API documents into canonical form.
 *
 * `--check` is the CI half and the reason the command is worth having: a formatter nobody enforces
 * is a formatter half the org runs. It writes nothing and exits non-zero when any file would
 * change, in the manner of `prettier --check`, which this repo's own gate already uses.
 */
export async function runFmt(patterns: string[], options: FmtOptions = {}): Promise<number> {
  const input = await resolveInput(patterns, options);
  if (isConfigFailure(input)) {
    console.error(input.error);
    return 1;
  }
  if (input.patterns.length === 0) {
    console.error(NO_PATTERNS_MESSAGE);
    return 1;
  }

  const seeds = await expandSeeds(input.patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${input.patterns.join(", ")}`);
    return 1;
  }

  const changed: string[] = [];
  const failed: { file: string; reason: string }[] = [];

  for (const file of seeds) {
    let original: string;
    try {
      original = await fs.readFile(file, "utf-8");
    } catch (error) {
      failed.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    let formatted: string;
    try {
      formatted = formatDocumentText(original);
    } catch (error) {
      // A file that doesn't parse can't be formatted, and rewriting it on a guess would destroy
      // it. Report and move on, so one broken document doesn't stop the other forty.
      failed.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    if (formatted === original) continue;
    changed.push(file);
    if (!options.check) await fs.writeFile(file, formatted, "utf-8");
  }

  const relative = (file: string) => path.relative(process.cwd(), file);

  for (const failure of failed) {
    console.error(`  ! ${relative(failure.file)}: ${failure.reason}`);
  }

  if (options.check) {
    if (changed.length === 0 && failed.length === 0) {
      console.log(`${seeds.length} file(s) already formatted.`);
      return 0;
    }
    for (const file of changed) console.error(`  ~ ${relative(file)}`);
    console.error(
      `\n${changed.length} file(s) would be reformatted${failed.length > 0 ? `, ${failed.length} could not be read` : ""}. Run \`teamapi fmt\` to fix.`,
    );
    return 1;
  }

  for (const file of changed) console.log(`  ~ ${relative(file)}`);
  console.log(
    changed.length === 0
      ? `${seeds.length} file(s) already formatted.`
      : `\nFormatted ${changed.length} of ${seeds.length} file(s).`,
  );
  // Unformattable files are still a failure even when writing: the caller asked for every document
  // to end up canonical and one of them didn't.
  return failed.length > 0 ? 1 : 0;
}
