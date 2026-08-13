import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";
import {
  AgentStatusSchema,
  ContextMappingPatternSchema,
  DependencyTypeSchema,
  DurationUnitSchema,
  InteractionModeSchema,
  KnowledgeBaseKindSchema,
  MemoryKindSchema,
  PlaybookCategorySchema,
  PolicyCategorySchema,
  PolicySeveritySchema,
  SpecificationKindSchema,
  SpecificationStatusSchema,
  SteeringCategorySchema,
  SteeringScopeSchema,
  SUGGESTED_ROLE_KINDS,
  TeamApiDocumentSchema,
  TeamTypeSchema,
} from "@jgalego/teamapi-schema";
import { buildOrgGraph } from "../resolve/graph-builder";
import { deriveContextMap } from "../context-map/derive";

const SPEC_PATH = path.resolve(__dirname, "../../../../docs/spec/teamapi-extended-v1.md");
const FIXTURES_DIR = path.resolve(__dirname, "../../../../docs/spec/conformance");
const SPEC = fs.readFileSync(SPEC_PATH, "utf-8");

/* ------------------------------------------------------------------------------------------- */
/* Behavioural fixtures                                                                         */
/* ------------------------------------------------------------------------------------------- */

interface Fixture {
  clause: string;
  requirement: string;
  files: Record<string, string>;
  seeds?: string[];
  expect: {
    outcome: "resolved" | "rejected";
    reasonContains?: string;
    teams?: string[];
    edges?: string[];
    roleEdges?: string[];
    unresolved?: number;
    unresolvedReasonContains?: string;
    passthrough?: Record<string, unknown>;
    contextMap?: string[];
    contextMapConflicts?: number;
  };
}

function loadFixtures(): Array<{ name: string; fixture: Fixture }> {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".yml"))
    .sort()
    .map((name) => ({
      name,
      fixture: YAML.load(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8")) as Fixture,
    }));
}

const FIXTURES = loadFixtures();

/** Writes a fixture's documents to a fresh temp directory, so relative `$ref`s resolve exactly as
 * they do on disk rather than through a loader stub that might resolve them differently. */
function materialize(fixture: Fixture, root: string): string[] {
  for (const [relative, content] of Object.entries(fixture.files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf-8");
  }
  const seeds = fixture.seeds ?? Object.keys(fixture.files);
  return seeds.map((relative) => path.join(root, relative));
}

const tmpRoots: string[] = [];
afterAll(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe("spec conformance fixtures", () => {
  // A `describe.each` over an empty directory is a green suite over nothing.
  it("has fixtures to run", () => {
    expect(FIXTURES.length).toBeGreaterThan(0);
  });

  it.each(FIXTURES)("$name", async ({ name, fixture }) => {
    // The clause has to name a real section, or the fixture is pinning a sentence that has since
    // been renamed or deleted — which is the drift this suite exists to catch.
    expect({ fixture: name, clause: fixture.clause, present: SPEC.includes(`## ${fixture.clause}`) }).toMatchObject({
      present: true,
    });
    expect(fixture.requirement.trim().length).toBeGreaterThan(0);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "teamapi-conformance-"));
    tmpRoots.push(root);
    const seedUris = materialize(fixture, root);

    if (fixture.expect.outcome === "rejected") {
      // `allowPartial: false` so the failure is thrown with its diagnosis attached, which is what
      // a person editing the document actually reads.
      await expect(buildOrgGraph({ seedUris })).rejects.toThrow(fixture.expect.reasonContains);
      return;
    }

    const graph = await buildOrgGraph({ seedUris, allowPartial: true });

    if (fixture.expect.teams) {
      expect([...graph.teams.keys()].sort()).toEqual(fixture.expect.teams);
    }
    if (fixture.expect.edges) {
      expect(graph.edges.map((e) => `${e.kind} ${e.from} -> ${e.to}`).sort()).toEqual(fixture.expect.edges);
    }
    if (fixture.expect.roleEdges) {
      expect(
        graph.roleEdges.map((e) => `${e.kind} ${e.fromTeam}.${e.fromRole} -> ${e.toTeam}.${e.toRole}`).sort(),
      ).toEqual(fixture.expect.roleEdges);
    }
    expect(graph.unresolved.map((u) => u.reason)).toHaveLength(fixture.expect.unresolved ?? 0);
    if (fixture.expect.unresolvedReasonContains) {
      expect(graph.unresolved.map((u) => u.reason).join("\n")).toContain(fixture.expect.unresolvedReasonContains);
    }
    if (fixture.expect.passthrough) {
      const doc = [...graph.teams.values()][0]!.doc as unknown as Record<string, unknown>;
      expect(doc).toMatchObject(fixture.expect.passthrough);
    }
    if (fixture.expect.contextMap) {
      const map = deriveContextMap(graph);
      expect(map.relationships.map((r) => `${r.from} -> ${r.to} ${r.mode} ${r.pattern ?? "-"} (${r.source})`)).toEqual(
        fixture.expect.contextMap,
      );
    }
    if (fixture.expect.contextMapConflicts !== undefined) {
      expect(deriveContextMap(graph).conflicts).toHaveLength(fixture.expect.contextMapConflicts);
    }
  });
});

/* ------------------------------------------------------------------------------------------- */
/* Document-vs-implementation drift                                                             */
/* ------------------------------------------------------------------------------------------- */

/**
 * Pulls the values out of a row of the spec's enum reference table.
 *
 * The row is markdown, so the separator between values is an escaped `\|` — escaped precisely so
 * it does not end the table cell, which is what makes it distinguishable from the cell delimiters
 * around it.
 */
function enumRowValues(enumName: string): string[] {
  const row = SPEC.split("\n").find((line) => line.startsWith(`| ${enumName} `));
  if (!row) throw new Error(`No row for '${enumName}' in the spec's enum reference table`);

  // Split on the cell delimiters only — an escaped `\\|` is a separator *inside* a cell, and
  // splitting on it too would read every enum value as its own column.
  const cell = row.split(/(?<!\\)\|/)[2];
  if (cell === undefined) throw new Error(`Malformed enum reference row for '${enumName}'`);

  // The values are the first backticked run; anything after it is prose (the suggested-role-kinds
  // row names its constant and says the field is not enforced).
  const values = /`([^`]+)`/.exec(cell)?.[1];
  if (values === undefined) throw new Error(`No backticked value list for '${enumName}'`);

  return values
    .split("\\|")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * The enum reference table, checked against the schema it mirrors.
 *
 * This is the drift a reviewer catches by chance and a test catches every time: a value added to a
 * Zod enum and not to the table reads, to anyone writing a document from the spec, as unsupported.
 * A value in the table and not the enum is worse — it reads as supported and fails validation.
 */
describe("spec enum reference matches the schema", () => {
  const CASES: Array<[string, readonly string[]]> = [
    ["Team type", TeamTypeSchema.options],
    ["Interaction mode", InteractionModeSchema.options],
    ["Duration unit", DurationUnitSchema.options],
    ["Context-mapping pattern", ContextMappingPatternSchema.options],
    ["Dependency type", DependencyTypeSchema.options],
    ["Suggested role kind (not enforced)", SUGGESTED_ROLE_KINDS],
    ["Agent status", AgentStatusSchema.options],
    ["Memory kind", MemoryKindSchema.options],
    ["Specification kind", SpecificationKindSchema.options],
    ["Specification status", SpecificationStatusSchema.options],
    ["Steering category", SteeringCategorySchema.options],
    ["Steering scope", SteeringScopeSchema.options],
    ["Playbook category", PlaybookCategorySchema.options],
    ["Policy category", PolicyCategorySchema.options],
    ["Policy severity", PolicySeveritySchema.options],
    ["Knowledge base kind", KnowledgeBaseKindSchema.options],
  ];

  it.each(CASES)("%s", (enumName, options) => {
    expect(enumRowValues(enumName)).toEqual([...options]);
  });
});

describe("spec root object table matches the schema", () => {
  it("documents every field, and no field the schema does not have", () => {
    const schemaKeys = Object.keys(TeamApiDocumentSchema.shape).sort();
    const section = SPEC.slice(SPEC.indexOf("## Root object"), SPEC.indexOf("## Info"));
    const documented = [...section.matchAll(/^\| `([A-Za-z]+)`\s+\|/gm)].map((match) => match[1]!).sort();
    expect(documented).toEqual(schemaKeys);
  });
});

describe("spec $ref traversal list matches the resolver", () => {
  /** The five bullets the spec names as the places `$ref` is followed. */
  const DOCUMENTED = [...SPEC.matchAll(/^- `([^`]+\$ref)` — /gm)].map((match) => match[1]!);

  it("names exactly the five fields the resolver traverses", () => {
    expect(DOCUMENTED).toEqual([
      "platform.$ref",
      "interactions[].$ref",
      "dependencies[].$ref",
      "roles[].reportsToRef.$ref",
      "roles[].alignsWith[].$ref",
    ]);
  });

  // The list above is prose. This is the same claim, executed: a document whose only `$ref`s are
  // in the five documented places reaches every other team, and one whose `$ref`s are anywhere
  // else reaches none. `02-work-refs-not-traversed.yml` covers the negative half on `work`.
  it("reaches every referenced team through those five fields and no others", async () => {
    const fixture = FIXTURES.find((entry) => entry.name === "01-ref-traversal.yml");
    expect(fixture).toBeDefined();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "teamapi-conformance-"));
    tmpRoots.push(root);
    const graph = await buildOrgGraph({ seedUris: materialize(fixture!.fixture, root) });
    expect([...graph.teams.keys()].sort()).toEqual(["hub", "peer", "platform", "supplier"]);
  });
});
