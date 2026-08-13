import { describe, expect, it } from "vitest";
import {
  assessVersion,
  isFutureVersion,
  LATEST_TEAM_API_VERSION,
  MIGRATIONS,
  migrateDocument,
  supportedVersions,
  type Migration,
} from "../migrate";

const current = () => ({ teamApiVersion: LATEST_TEAM_API_VERSION, id: "team-a" });

/**
 * Fixtures, not shipped migrations. The registry is deliberately empty — a placeholder migration
 * invented to prove the machinery works would be one real documents could hit — so the runner is
 * exercised against chains defined here instead. Same code, no shipped transformation.
 */
const bumpTo = (from: string, to: string, mark: string): Migration => ({
  from,
  to,
  description: `bump ${from} to ${to}`,
  migrate: (raw) => ({ ...raw, teamApiVersion: to, [mark]: true }),
});

describe("isFutureVersion", () => {
  it.each([
    ["2.0.0", true],
    ["1.1.0", true],
    ["1.0.1", true],
    ["1.0.0", false],
    ["0.9.0", false],
  ])("reads %s as future=%s against 1.0.0", (version, expected) => {
    expect(isFutureVersion(version, "1.0.0")).toBe(expected);
  });

  it("compares numerically, not lexically", () => {
    // A string comparison would call 10.0.0 older than 9.0.0 and start telling people their new
    // documents were out of date.
    expect(isFutureVersion("10.0.0", "9.0.0")).toBe(true);
    expect(isFutureVersion("9.0.0", "10.0.0")).toBe(false);
  });

  it("treats a shorter version as zero-padded", () => {
    expect(isFutureVersion("2", "1.0.0")).toBe(true);
    expect(isFutureVersion("1", "1.0.0")).toBe(false);
  });

  it("pads the other side too, for a version with more parts than the latest", () => {
    // A four-part build number against a three-part release: 1.0.0.1 is ahead of 1.0.0, and
    // 1.0.0.0 is the same release.
    expect(isFutureVersion("1.0.0.1", "1.0.0")).toBe(true);
    expect(isFutureVersion("1.0.0.0", "1.0.0")).toBe(false);
  });

  it("declines to guess about a version that is not numeric", () => {
    // Falls through to the "this build doesn't know it" branch rather than asserting an ordering
    // it cannot actually determine.
    expect(isFutureVersion("nightly", "1.0.0")).toBe(false);
  });
});

describe("assessVersion", () => {
  it("calls the latest version current", () => {
    expect(assessVersion(current())).toMatchObject({ status: "current", declared: LATEST_TEAM_API_VERSION });
  });

  it("distinguishes a document from the future from one from the past", () => {
    // The whole point: these read identically to the schema and need opposite responses.
    expect(assessVersion({ teamApiVersion: "2.0.0" }).status).toBe("future");
    expect(assessVersion({ teamApiVersion: "0.9.0" }).status).toBe("unmigratable");
  });

  it("tells a reader with a future document to upgrade the tool, not edit the file", () => {
    expect(assessVersion({ teamApiVersion: "2.0.0" }).advice).toMatch(/Upgrade @jgalego\/teamapi/);
  });

  it("reports a missing version distinctly from a wrong one", () => {
    const assessment = assessVersion({ id: "team-a" });
    expect(assessment.status).toBe("unversioned");
    expect(assessment.declared).toBeUndefined();
    expect(assessment.advice).toContain("teamApiVersion");
  });

  it("treats a non-string version as absent rather than crashing", () => {
    expect(assessVersion({ teamApiVersion: 1 }).status).toBe("unversioned");
  });

  it("finds a single-step chain", () => {
    const assessment = assessVersion({ teamApiVersion: "0.9.0" }, [bumpTo("0.9.0", "1.0.0", "a")]);
    expect(assessment.status).toBe("migratable");
    expect(assessment.chain).toHaveLength(1);
  });

  it("finds a multi-step chain and orders it", () => {
    const assessment = assessVersion({ teamApiVersion: "0.8.0" }, [
      bumpTo("0.9.0", "1.0.0", "b"),
      bumpTo("0.8.0", "0.9.0", "a"),
    ]);
    expect(assessment.chain.map((step) => step.from)).toEqual(["0.8.0", "0.9.0"]);
  });

  it("reports a broken chain as unmigratable rather than half-migrating", () => {
    // A chain that stops short would otherwise leave documents at an intermediate version no
    // schema in this build accepts.
    const assessment = assessVersion({ teamApiVersion: "0.8.0" }, [bumpTo("0.8.0", "0.9.0", "a")]);
    expect(assessment.status).toBe("unmigratable");
  });

  it("refuses to loop on a cyclic registry", () => {
    const cyclic = [bumpTo("0.9.0", "0.8.0", "a"), bumpTo("0.8.0", "0.9.0", "b")];
    expect(assessVersion({ teamApiVersion: "0.9.0" }, cyclic).status).toBe("unmigratable");
  });
});

describe("migrateDocument", () => {
  it("runs every step in order", () => {
    const result = migrateDocument({ teamApiVersion: "0.8.0", id: "team-a" }, [
      bumpTo("0.8.0", "0.9.0", "first"),
      bumpTo("0.9.0", "1.0.0", "second"),
    ]);
    expect(result.changed).toBe(true);
    expect(result.document).toMatchObject({ teamApiVersion: "1.0.0", id: "team-a", first: true, second: true });
  });

  it("does not mutate the document it was given", () => {
    const original = { teamApiVersion: "0.9.0", id: "team-a" };
    migrateDocument(original, [bumpTo("0.9.0", "1.0.0", "a")]);
    expect(original).toEqual({ teamApiVersion: "0.9.0", id: "team-a" });
  });

  it("is a no-op on a current document", () => {
    const document = current();
    const result = migrateDocument(document);
    expect(result.changed).toBe(false);
    expect(result.document).toBe(document);
  });

  it("leaves an unmigratable document untouched", () => {
    const result = migrateDocument({ teamApiVersion: "0.9.0" });
    expect(result.changed).toBe(false);
    expect(result.assessment.status).toBe("unmigratable");
  });

  it("leaves a future document untouched", () => {
    const result = migrateDocument({ teamApiVersion: "2.0.0" });
    expect(result.changed).toBe(false);
    expect(result.assessment.status).toBe("future");
  });
});

describe("the shipped registry", () => {
  it("registers no migrations yet", () => {
    // There is one version. A migration here today would be one nobody asked for.
    expect(MIGRATIONS).toEqual([]);
  });

  it("agrees with the schema registry about what the latest version is", () => {
    // These drifting apart would mean new documents were written at a version the resolver
    // rejects, which nothing else would catch.
    const supported = supportedVersions();
    expect(supported).toContain(LATEST_TEAM_API_VERSION);
    expect(supported.at(-1)).toBe(LATEST_TEAM_API_VERSION);
  });
});
