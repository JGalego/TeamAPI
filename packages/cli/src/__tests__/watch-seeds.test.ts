import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collapseNested, resolveWatchRoots } from "../watch-seeds";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-watch-roots-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeTeam(relative: string) {
  const file = path.join(tmpDir, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      teamApiVersion: "1.0.0",
      id: path.basename(path.dirname(file)),
      info: { name: "T", type: "stream-aligned" },
    }),
    "utf-8",
  );
  return file;
}

describe("collapseNested", () => {
  it("drops a directory already covered by a watched parent", () => {
    expect(collapseNested([`${path.sep}org`, `${path.sep}org${path.sep}team-a`])).toEqual([`${path.sep}org`]);
  });

  it("keeps siblings", () => {
    const dirs = [`${path.sep}a`, `${path.sep}b`];
    expect(collapseNested(dirs)).toEqual(dirs);
  });

  it("does not treat a name-prefix as a parent", () => {
    // `/org-archive` is not inside `/org`, despite the string prefix.
    const dirs = [`${path.sep}org`, `${path.sep}org-archive`];
    expect(collapseNested(dirs)).toEqual(dirs);
  });

  it("de-duplicates", () => {
    expect(collapseNested([`${path.sep}a`, `${path.sep}a`])).toEqual([`${path.sep}a`]);
  });
});

describe("resolveWatchRoots", () => {
  it("anchors on the directory the user named, not on where the files are today", async () => {
    await writeTeam("team-a/teamapi.yml");
    // Anchoring deeper would mean a later `team-b/teamapi.yml` was never noticed.
    expect(await resolveWatchRoots([tmpDir])).toEqual([path.resolve(tmpDir)]);
  });

  it("watches the containing directory of a file path", async () => {
    const file = await writeTeam("team-a/teamapi.yml");
    expect(await resolveWatchRoots([file])).toEqual([path.dirname(file)]);
  });

  it("watches the directories a glob currently matches", async () => {
    await writeTeam("team-a/teamapi.yml");
    await writeTeam("team-b/teamapi.yml");
    const roots = await resolveWatchRoots([path.join(tmpDir, "*", "teamapi.yml")]);
    expect(roots.sort()).toEqual([path.join(tmpDir, "team-a"), path.join(tmpDir, "team-b")].sort());
  });

  it("collapses a directory and a file inside it into the single recursive watch", async () => {
    const file = await writeTeam("team-a/teamapi.yml");
    expect(await resolveWatchRoots([tmpDir, file])).toEqual([path.resolve(tmpDir)]);
  });
});
