import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { assessVersion, LATEST_TEAM_API_VERSION, migrateDocument, type VersionStatus } from "@jgalego/teamapi-schema";
import { formatDocumentText } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { isConfigFailure, NO_PATTERNS_MESSAGE, resolveInput, type ConfigAwareOptions } from "../with-config";

export interface MigrateOptions extends ConfigAwareOptions {
  /** Report what would change without writing anything. */
  check?: boolean;
}

interface FileAssessment {
  file: string;
  status: VersionStatus;
  declared?: string;
  advice: string;
}

const MARK: Record<VersionStatus, string> = {
  current: " ",
  migratable: "~",
  unmigratable: "!",
  future: "!",
  unversioned: "!",
};

/**
 * Brings documents up to the latest `teamApiVersion`, and explains the ones it can't.
 *
 * With no migrations registered the useful half is the explanation. `validate` can only say a
 * version is not `"1.0.0"`, which is the same message whether the document predates the toolchain
 * or postdates it — and those need opposite responses: edit the file, or upgrade the CLI. This
 * distinguishes them and says which.
 */
export async function runMigrate(patterns: string[], options: MigrateOptions = {}): Promise<number> {
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

  const assessments: FileAssessment[] = [];
  const migrated: string[] = [];
  const unreadable: { file: string; reason: string }[] = [];

  for (const file of seeds) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf-8");
    } catch (error) {
      unreadable.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    let raw: unknown;
    try {
      raw = YAML.load(text);
    } catch (error) {
      unreadable.push({ file, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      unreadable.push({ file, reason: "expected a YAML mapping at the top level" });
      continue;
    }

    const document = raw as Record<string, unknown>;
    const assessment = assessVersion(document);
    assessments.push({ file, status: assessment.status, declared: assessment.declared, advice: assessment.advice });

    if (assessment.status !== "migratable" || options.check) continue;

    const result = migrateDocument(document);
    if (!result.changed) continue;

    // Written back through the formatter, so a migrated document lands canonical rather than in
    // whatever shape the transformation happened to leave it — a migration that reformatted every
    // file as a side effect would bury its own diff.
    await fs.writeFile(file, formatDocumentText(YAML.dump(result.document, { noRefs: true })), "utf-8");
    migrated.push(file);
  }

  const relative = (file: string) => path.relative(process.cwd(), file);
  const notable = assessments.filter((entry) => entry.status !== "current");

  for (const entry of notable) {
    const line = `${MARK[entry.status]} ${relative(entry.file)}: ${entry.advice}`;
    if (entry.status === "migratable") console.log(line);
    else console.error(line);
  }
  for (const failure of unreadable) {
    console.error(`! ${relative(failure.file)}: ${failure.reason}`);
  }

  const current = assessments.length - notable.length;
  const blocked = notable.filter((entry) => entry.status !== "migratable").length + unreadable.length;

  if (notable.length === 0 && unreadable.length === 0) {
    console.log(`${current} file(s) already at ${LATEST_TEAM_API_VERSION}.`);
    return 0;
  }

  const pending = notable.filter((entry) => entry.status === "migratable").length;
  if (options.check) {
    console.log(`\n${pending} file(s) would be migrated, ${blocked} need attention, ${current} already current.`);
    // `--check` fails on anything not current, migratable included: that is what makes it usable
    // as a gate, in the manner of `fmt --check`.
    return pending + blocked > 0 ? 1 : 0;
  }

  console.log(`\nMigrated ${migrated.length} file(s); ${blocked} need attention, ${current} already current.`);
  // A migratable file that has now been migrated is not a failure. One this build cannot handle
  // is, whichever direction it is out of step in.
  return blocked > 0 ? 1 : 0;
}
