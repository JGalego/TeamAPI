import { SCHEMA_REGISTRY, type SupportedTeamApiVersion } from "./registry";

/**
 * Document migration between `teamApiVersion`s.
 *
 * There is exactly one version today, so there is nothing to migrate *yet* — and that is precisely
 * when this needs to exist. A format with one version and no migration mechanism doesn't have a
 * migration problem; it has a migration problem scheduled for the day the second version ships,
 * by which point documents are spread across every repository in an org and whatever gets built
 * under that pressure becomes the permanent answer.
 *
 * What the mechanism buys before it has any migrations in it is the diagnostics. A document
 * declaring a version this build doesn't know currently fails as `teamApiVersion: Invalid literal
 * value, expected "1.0.0"` — true, and unable to distinguish "your documents are older than your
 * toolchain, run migrate" from "your documents are newer than your toolchain, upgrade it". Those
 * need completely different actions from the reader.
 */

/** The version new documents are written at, and the target every migration chain walks toward. */
export const LATEST_TEAM_API_VERSION = "1.0.0" satisfies SupportedTeamApiVersion;

export interface Migration {
  /** The `teamApiVersion` this migration reads. */
  from: string;
  /** The `teamApiVersion` it produces. */
  to: string;
  /** One line, shown by `teamapi migrate` before it changes anything. */
  description: string;
  /** Transforms a raw (unvalidated) document. Must not mutate its input. */
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>;
}

/**
 * Every known migration, ordered oldest-first.
 *
 * Deliberately empty. A placeholder migration invented to prove the machinery works would be a
 * migration real documents could hit, and the tests exercise the runner with their own fixtures
 * instead — which tests the same code without shipping a transformation nobody asked for.
 */
export const MIGRATIONS: readonly Migration[] = [];

export type VersionStatus =
  /** Already at the latest version. */
  | "current"
  /** Older than the latest, with a migration chain that reaches it. */
  | "migratable"
  /** Older than the latest, and no chain of registered migrations reaches it. */
  | "unmigratable"
  /** Newer than anything this build knows: the toolchain is behind the documents. */
  | "future"
  /** No `teamApiVersion` at all, or one that isn't a string. */
  | "unversioned";

export interface VersionAssessment {
  status: VersionStatus;
  /** The document's declared version, when it has one. */
  declared?: string;
  /** The migrations that would run, in order. Empty unless `status` is `migratable`. */
  chain: Migration[];
  /** A sentence naming what the reader should do about it. */
  advice: string;
}

function declaredVersion(raw: Record<string, unknown>): string | undefined {
  const value = raw.teamApiVersion;
  return typeof value === "string" ? value : undefined;
}

/**
 * Whether a declared version is *ahead* of this build rather than behind it.
 *
 * Compared as dotted numbers, not lexically: `"10.0.0" > "9.0.0"` is false as a string comparison,
 * and a format that reaches double digits would start telling people their new documents are old.
 * A version that doesn't parse as numbers is treated as not-future, so it falls through to the
 * unmigratable branch and gets the "this build doesn't know it" message rather than a confident
 * claim about ordering.
 */
export function isFutureVersion(declared: string, latest: string = LATEST_TEAM_API_VERSION): boolean {
  const parse = (version: string) => version.split(".").map((part) => Number(part));
  const left = parse(declared);
  const right = parse(latest);
  if ([...left, ...right].some((part) => !Number.isInteger(part))) return false;

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/** Walks the registered migrations from `from`, returning the chain that reaches the latest
 * version, or `undefined` when no such chain exists. */
function chainFrom(from: string, migrations: readonly Migration[]): Migration[] | undefined {
  const chain: Migration[] = [];
  const seen = new Set<string>([from]);
  let cursor = from;

  while (cursor !== LATEST_TEAM_API_VERSION) {
    const next = migrations.find((migration) => migration.from === cursor);
    if (!next) return undefined;
    // A registry with a cycle would otherwise spin forever on a document nobody could fix.
    if (seen.has(next.to)) return undefined;
    seen.add(next.to);
    chain.push(next);
    cursor = next.to;
  }
  return chain;
}

export function assessVersion(
  raw: Record<string, unknown>,
  migrations: readonly Migration[] = MIGRATIONS,
): VersionAssessment {
  const declared = declaredVersion(raw);

  if (declared === undefined) {
    return {
      status: "unversioned",
      chain: [],
      advice: `No teamApiVersion. Add \`teamApiVersion: "${LATEST_TEAM_API_VERSION}"\` — the field is what tells tooling which schema this document follows.`,
    };
  }

  if (declared === LATEST_TEAM_API_VERSION) {
    return { status: "current", declared, chain: [], advice: "Already at the latest version." };
  }

  if (isFutureVersion(declared)) {
    return {
      status: "future",
      declared,
      chain: [],
      // The one case where the document is right and the tool is wrong. Saying "invalid" here
      // would send the reader to edit a file that has nothing wrong with it.
      advice: `This document declares ${declared}, which is newer than this build understands (${LATEST_TEAM_API_VERSION}). Upgrade @jgalego/teamapi rather than changing the document.`,
    };
  }

  const chain = chainFrom(declared, migrations);
  if (!chain) {
    return {
      status: "unmigratable",
      declared,
      chain: [],
      advice: `No migration path from ${declared} to ${LATEST_TEAM_API_VERSION} is registered in this build.`,
    };
  }

  return {
    status: "migratable",
    declared,
    chain,
    advice: `Migratable from ${declared} to ${LATEST_TEAM_API_VERSION} in ${chain.length} step(s): ${chain
      .map((step) => step.description)
      .join("; ")}.`,
  };
}

export interface MigrationResult {
  /** The migrated document, or the original when nothing ran. */
  document: Record<string, unknown>;
  /** Whether anything actually changed. */
  changed: boolean;
  assessment: VersionAssessment;
}

/**
 * Runs every migration needed to bring a raw document to the latest version.
 *
 * Raw, not parsed: a document that needs migrating is by definition one the current schema
 * rejects, so validating first would make migration impossible. Validation is the caller's job,
 * afterwards — which is also the check that the migration produced something coherent.
 */
export function migrateDocument(
  raw: Record<string, unknown>,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult {
  const assessment = assessVersion(raw, migrations);
  if (assessment.status !== "migratable") {
    return { document: raw, changed: false, assessment };
  }

  let document = raw;
  for (const step of assessment.chain) {
    document = step.migrate(document);
  }
  return { document, changed: true, assessment };
}

/** Every version this build can read, latest last. */
export function supportedVersions(): string[] {
  return Object.keys(SCHEMA_REGISTRY).sort();
}
