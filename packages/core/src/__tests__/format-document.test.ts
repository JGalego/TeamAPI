import { describe, expect, it } from "vitest";
import * as YAML from "js-yaml";
import { CANONICAL_KEY_ORDER, formatDocumentText } from "../serialize/format-document";

const MINIMAL = `teamApiVersion: "1.0.0"
id: team-a
info:
  name: Team A
  type: stream-aligned
`;

describe("formatDocumentText — ordering", () => {
  it("moves top-level keys into canonical order", () => {
    const scrambled = `agents: []
info:
  name: Team A
  type: stream-aligned
teamApiVersion: "1.0.0"
id: team-a
`;
    const keys = Object.keys(YAML.load(formatDocumentText(scrambled)) as Record<string, unknown>);
    expect(keys).toEqual(["teamApiVersion", "id", "info", "agents"]);
  });

  it("uses schema order rather than alphabetical", () => {
    // Alphabetical would open every document with `agents` and bury `info` in the middle.
    expect(CANONICAL_KEY_ORDER.indexOf("info")).toBeLessThan(CANONICAL_KEY_ORDER.indexOf("agents"));
    expect(CANONICAL_KEY_ORDER[0]).toBe("teamApiVersion");
  });

  it("keeps unknown keys, after the known ones and in their original order", () => {
    // The schema passes unknown fields through, so an org may be carrying a newer spec or a local
    // extension. Dropping them would be data loss; reordering them would be a guess.
    const withExtras = `${MINIMAL}zeta: 1
alpha: 2
`;
    const keys = Object.keys(YAML.load(formatDocumentText(withExtras)) as Record<string, unknown>);
    expect(keys).toEqual(["teamApiVersion", "id", "info", "zeta", "alpha"]);
  });

  it("is idempotent", () => {
    const once = formatDocumentText(`info:\n  name: Team A\n  type: platform\nid: team-a\nteamApiVersion: "1.0.0"\n`);
    expect(formatDocumentText(once)).toBe(once);
  });
});

/** The property that decides whether this command is safe to run across an org. */
describe("formatDocumentText — comments", () => {
  it("keeps a comment above a top-level key", () => {
    const commented = `teamApiVersion: "1.0.0"
id: team-a
info:
  name: Team A
  type: stream-aligned
# Why this team runs no agents: a compliance review is still open.
agents: []
`;
    expect(formatDocumentText(commented)).toContain("# Why this team runs no agents");
  });

  it("carries a section's comment with it when the section moves", () => {
    // The whole risk of a reordering formatter: an explanation left behind attaches itself to
    // whatever key happens to land in its place, which is worse than losing it.
    const scrambled = `# This team has no agents, deliberately.
agents: []
teamApiVersion: "1.0.0"
id: team-a
info:
  name: Team A
  type: stream-aligned
`;
    const formatted = formatDocumentText(scrambled);
    const lines = formatted.split("\n");
    const commentLine = lines.findIndex((line) => line.includes("no agents, deliberately"));
    expect(commentLine).toBeGreaterThanOrEqual(0);
    expect(lines[commentLine + 1]).toContain("agents:");
  });

  it("keeps inline and nested comments", () => {
    const commented = `teamApiVersion: "1.0.0"
id: team-a
info:
  name: Team A
  type: stream-aligned
roles:
  # The only role with cross-team authority.
  - id: tech-lead
    name: Tech Lead
    kind: TechLead
`;
    const formatted = formatDocumentText(commented);
    expect(formatted).toContain("# The only role with cross-team authority.");
  });
});

describe("formatDocumentText — values", () => {
  it("keeps teamApiVersion quoted", () => {
    // Unquoted, a two-part version like `1.0` reads back as a float and stops validating.
    expect(formatDocumentText(MINIMAL)).toContain('teamApiVersion: "1.0.0"');
  });

  it("re-quotes a version that arrived unquoted", () => {
    const unquoted = `teamApiVersion: 1.0.0\nid: team-a\ninfo:\n  name: Team A\n  type: platform\n`;
    expect(formatDocumentText(unquoted)).toContain('teamApiVersion: "1.0.0"');
  });

  it("writes flow collections without inner padding", () => {
    const withList = `${MINIMAL}members:\n  - id: a\n    name: A\n    roleIds: [tech-lead]\n`;
    expect(formatDocumentText(withList)).toContain("roleIds: [tech-lead]");
  });

  it("preserves the values themselves through a round trip", () => {
    const rich = `teamApiVersion: "1.0.0"
id: team-a
info:
  name: Team A
  type: stream-aligned
  focus: Owns checkout
cognitiveLoad:
  intrinsic: 6
  extraneous: 8
  germane: 4
services:
  - name: checkout-api
    repository: https://example.test/repo
`;
    expect(YAML.load(formatDocumentText(rich))).toEqual(YAML.load(rich));
  });
});

describe("formatDocumentText — rejections", () => {
  it("refuses a document that is not a mapping", () => {
    expect(() => formatDocumentText("- one\n- two\n")).toThrow(/mapping/);
  });

  it("refuses an empty document rather than emitting one", () => {
    expect(() => formatDocumentText("")).toThrow(/mapping/);
  });

  it("refuses unparseable YAML instead of rewriting it on a guess", () => {
    expect(() => formatDocumentText("key: [unclosed\n")).toThrow();
  });
});
