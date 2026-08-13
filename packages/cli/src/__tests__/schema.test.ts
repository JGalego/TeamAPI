import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEAM_API_SCHEMA_URL } from "@jgalego/teamapi-schema";
import { runSchema } from "../commands/schema";

const PUBLISHED_SCHEMA = path.resolve(__dirname, "../../../../site/schema/v1.json");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-schema-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("teamapi schema", () => {
  it("writes a parseable JSON Schema to --out, creating missing directories", async () => {
    const outFile = path.join(tmpDir, "nested", "dir", "v1.json");
    const code = await runSchema({ out: outFile });
    expect(code).toBe(0);

    const written = JSON.parse(await fs.readFile(outFile, "utf-8")) as Record<string, unknown>;
    expect(written.$id).toBe(TEAM_API_SCHEMA_URL);
    expect(written.$ref).toBe("#/definitions/TeamApiDocument");
  });

  it("prints to stdout when no --out is given", async () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const code = await runSchema();
    expect(code).toBe(0);

    const printed = write.mock.calls.map(([chunk]) => String(chunk)).join("");
    expect(JSON.parse(printed)).toMatchObject({ $id: TEAM_API_SCHEMA_URL });
  });

  /**
   * The published schema is a generated artifact committed to the repo so GitHub Pages can serve
   * it at a stable URL. Nothing at runtime reads it back, so without this check it would drift
   * silently the first time anyone touched a Zod schema — and editors would keep validating
   * every `teamapi.yml` in every org against a stale copy of the format.
   */
  it("matches the schema committed at site/schema/v1.json", async () => {
    const outFile = path.join(tmpDir, "v1.json");
    await runSchema({ out: outFile });

    const [regenerated, committed] = await Promise.all([
      fs.readFile(outFile, "utf-8"),
      fs.readFile(PUBLISHED_SCHEMA, "utf-8"),
    ]);
    expect(
      committed,
      "site/schema/v1.json is stale — regenerate it with `pnpm teamapi schema --out site/schema/v1.json`",
    ).toBe(regenerated);
  });
});
