import { isMap, isScalar, parseDocument, Scalar, type Document, type Pair } from "yaml";

/**
 * Canonical formatting for a Team API document.
 *
 * The problem is review, not aesthetics. These documents are edited by hand across a whole org, by
 * people who each have their own habits about where a new section goes, so two teams adding the
 * same thing produce diffs that look nothing alike — and a diff nobody can read is a review nobody
 * does, on a file that says who is accountable for what.
 *
 * This is built on `yaml`'s document API rather than the `js-yaml` load/dump the rest of the
 * package uses, and the reason is comments. A `load` followed by a `dump` silently discards every
 * comment in the file: run it across an org and the formatter would delete the explanations of
 * why a role reports across a boundary, why a team runs no agents, why a dependency is marked
 * blocking. That is not formatting, it is data loss, and it would be discovered one file at a time
 * long after the commit. `parseDocument` keeps comments attached to the nodes they belong to, so
 * reordering the top-level keys moves each section's commentary along with it.
 *
 * Everything else in the codebase keeps using `js-yaml`: it is the right tool for reading a
 * document into a value, which is all resolution ever needs.
 */

/**
 * Top-level keys, in the order `TeamApiDocumentSchema` declares them.
 *
 * Kept as a literal list rather than derived from the Zod shape at runtime: `z.object`'s key order
 * is an implementation detail a refactor could change without anyone noticing, and this list
 * reordering itself would silently reformat every document in every org that runs `fmt`.
 *
 * Schema order, not alphabetical. The document is meant to be read top to bottom — what this team
 * is, then what it owns, then who is on it, then how it relates to everyone else — and sorting
 * alphabetically would open every file with `agents` and bury `info` in the middle.
 */
export const CANONICAL_KEY_ORDER: readonly string[] = [
  "teamApiVersion",
  "id",
  "info",
  "channels",
  "searchTerms",
  "platform",
  "services",
  "work",
  "roles",
  "members",
  "cognitiveLoad",
  "meetings",
  "interactions",
  "dependencies",
  "agents",
  "memory",
  "specifications",
  "steeringDocuments",
  "prompts",
  "playbooks",
  "policies",
  "knowledgeBase",
  "workflows",
  "sessions",
];

const ORDER_INDEX = new Map(CANONICAL_KEY_ORDER.map((key, index) => [key, index]));

function keyOf(pair: Pair<unknown, unknown>): string | undefined {
  return isScalar(pair.key) && typeof pair.key.value === "string" ? pair.key.value : undefined;
}

/**
 * Sorts the document's top-level pairs into canonical order.
 *
 * A stable sort, and unknown keys sort last while keeping their relative order: the schema is
 * `.passthrough()`, so an org may legitimately carry fields this version has never heard of — a
 * newer spec, a local extension. Dropping them would be data loss and guessing where they belong
 * would be worse than leaving them where the author put them.
 */
function orderTopLevel(doc: Document): void {
  if (!isMap(doc.contents)) return;
  const rank = (pair: Pair<unknown, unknown>): number => {
    const key = keyOf(pair);
    return key !== undefined ? (ORDER_INDEX.get(key) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  };
  doc.contents.items = [...doc.contents.items].sort((a, b) => rank(a) - rank(b));
}

/**
 * Keeps `teamApiVersion` quoted.
 *
 * Left alone, the emitter writes `teamApiVersion: 1.0.0`, which round-trips today only because
 * `1.0.0` happens not to parse as a number. A two-part version would not be so lucky: `1.0` reads
 * back as a float, and the document stops validating against a schema expecting the string. The
 * quotes are load-bearing, so they are re-applied rather than left to the emitter's discretion.
 */
function quoteVersion(doc: Document): void {
  if (!isMap(doc.contents)) return;
  for (const pair of doc.contents.items) {
    if (keyOf(pair) !== "teamApiVersion") continue;
    if (isScalar(pair.value)) pair.value.type = Scalar.QUOTE_DOUBLE;
  }
}

/** Formats already-parsed YAML text, preserving its comments. */
export function formatDocumentText(text: string): string {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0]!.message);
  }
  if (!isMap(doc.contents)) {
    throw new Error("not a Team API document: expected a YAML mapping at the top level");
  }

  orderTopLevel(doc);
  quoteVersion(doc);

  // `lineWidth: 100` matches the repo's Prettier setting, so prose fields wrap the way the rest of
  // the repository does. `singleQuote: false` keeps string quoting consistent with the examples,
  // and `flowCollectionPadding: false` writes `[tech-lead]` rather than `[ tech-lead ]` — the
  // convention every document in the wild already follows, and the difference between a formatter
  // that is a no-op on idiomatic files and one that rewrites all of them on first run.
  return doc.toString({ lineWidth: 100, singleQuote: false, flowCollectionPadding: false });
}
