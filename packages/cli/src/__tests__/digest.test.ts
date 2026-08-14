import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDigest } from "../commands/digest";

const DRIFTWOOD = path.resolve(__dirname, "../../../../examples/driftwood-org/stream-insights/teamapi.yml");

let tmp: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-digest-"));
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  logSpy.mockRestore();
  errorSpy.mockRestore();
  vi.unstubAllGlobals();
});

const printed = (): string => logSpy.mock.calls.map((args) => String(args[0])).join("\n");

function stubWebhook(status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(status === 200 ? "ok" : "no", { status, statusText: "x" }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("runDigest", () => {
  it("returns 1 when no files match", async () => {
    expect(await runDigest(["/tmp/nope-*.yml"], {})).toBe(1);
  });

  it("prints a text digest by default", async () => {
    expect(await runDigest([DRIFTWOOD], {})).toBe(0);
    expect(printed()).toMatch(/teams — \d+ blocking/);
  });

  it("exits 0 even with blocking findings", async () => {
    // A digest that failed the build on a finding would be turned off within a fortnight, and
    // then nobody would get the digest either.
    expect(await runDigest([DRIFTWOOD], { format: "json" })).toBe(0);
    expect(JSON.parse(printed()).blocking).toBeGreaterThan(0);
  });

  it("writes to --out instead of stdout", async () => {
    const out = path.join(tmp, "nested", "digest.html");
    expect(await runDigest([DRIFTWOOD], { format: "html", out })).toBe(0);
    expect(await fs.readFile(out, "utf-8")).toContain("<h2");
    expect(printed()).toBe("");
  });

  it("carries state forward, and reports what moved on the second run", async () => {
    const state = path.join(tmp, "state.json");

    expect(await runDigest([DRIFTWOOD], { format: "json", state })).toBe(0);
    const first = JSON.parse(printed());
    expect(first.deltas).toEqual([]);

    // Nudge the snapshot so the second run has something to report, which is what a real week of
    // changes would do.
    const saved = JSON.parse(await fs.readFile(state, "utf-8"));
    await fs.writeFile(state, JSON.stringify({ ...saved, agents: 0 }), "utf-8");

    logSpy.mockClear();
    expect(await runDigest([DRIFTWOOD], { format: "json", state })).toBe(0);
    const second = JSON.parse(printed());
    expect(second.deltas.map((delta: { label: string }) => delta.label)).toContain("agents");
  });

  it("treats a missing state file as a first run rather than a failure", async () => {
    // Otherwise every installation's first scheduled run fails.
    expect(await runDigest([DRIFTWOOD], { format: "json", state: path.join(tmp, "absent.json") })).toBe(0);
    expect(JSON.parse(printed()).deltas).toEqual([]);
  });

  it("posts to a webhook, and does not also dump the payload into the log", async () => {
    const fetchMock = stubWebhook();
    expect(await runDigest([DRIFTWOOD], { webhook: "https://hooks.example.com/x" })).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(typeof body.text).toBe("string");
    expect(Array.isArray(body.blocks)).toBe(true);
    // A webhook run that also printed the JSON would fill a CI log with something nobody reads.
    expect(printed()).toBe("");
  });

  it("fails, and does not consume the comparison point, when the webhook rejects", async () => {
    // Writing state before a successful delivery would make the next run report no change at all.
    stubWebhook(500);
    const state = path.join(tmp, "state.json");
    expect(await runDigest([DRIFTWOOD], { webhook: "https://hooks.example.com/x", state })).toBe(1);
    await expect(fs.readFile(state, "utf-8")).rejects.toThrow();
  });
});
