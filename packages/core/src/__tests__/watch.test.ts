import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrgGraphStore } from "../resolve/store";
import { watchOrgGraph, type OrgGraphWatcher } from "../resolve/watch";

let tmpDir: string;
let watcher: OrgGraphWatcher | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "teamapi-watch-"));
});

afterEach(async () => {
  watcher?.close();
  watcher = undefined;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function teamDoc(id: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    teamApiVersion: "1.0.0",
    id,
    info: { name: id, type: "stream-aligned" },
    ...extra,
  });
}

async function writeTeam(id: string, extra: Record<string, unknown> = {}) {
  const file = path.join(tmpDir, `${id}.yml`);
  await fs.writeFile(file, teamDoc(id, extra), "utf-8");
  return file;
}

/** Waits for a condition the watcher will satisfy asynchronously, rather than sleeping a fixed
 * time — filesystem event latency varies far too much between platforms for a fixed wait. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not met before timeout");
}

describe("watchOrgGraph", () => {
  it("reloads when a watched document changes", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file], allowPartial: true });
    await store.load();
    expect(store.current.teams.get("team-a")!.doc.info.name).toBe("team-a");

    const reloads: number[] = [];
    watcher = watchOrgGraph({
      store,
      watchPaths: [tmpDir],
      debounceMs: 10,
      onReload: (graph) => reloads.push(graph.teams.size),
    });

    await fs.writeFile(file, teamDoc("team-a", { info: { name: "Renamed", type: "platform" } }), "utf-8");
    await until(() => reloads.length > 0);

    expect(store.current.teams.get("team-a")!.doc.info.name).toBe("Renamed");
  });

  it("picks up a team document added after startup", async () => {
    const first = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [first], allowPartial: true });
    await store.load();
    expect(store.current.teams.size).toBe(1);

    const reloads: number[] = [];
    watcher = watchOrgGraph({
      store,
      watchPaths: [tmpDir],
      debounceMs: 10,
      // The point of re-running discovery: without this the new file is invisible forever.
      resolveSeeds: async () => {
        const entries = await fs.readdir(tmpDir);
        return entries.filter((e) => e.endsWith(".yml")).map((e) => path.join(tmpDir, e));
      },
      onReload: (graph) => reloads.push(graph.teams.size),
    });

    await writeTeam("team-b");
    await until(() => store.current.teams.size === 2);
    expect([...store.current.teams.keys()].sort()).toEqual(["team-a", "team-b"]);
  });

  /** The failure this module is built around. */
  it("keeps serving the last good graph when a reload fails", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file] }); // no allowPartial: a bad document throws
    await store.load();

    const errors: string[] = [];
    watcher = watchOrgGraph({
      store,
      watchPaths: [tmpDir],
      debounceMs: 10,
      onError: (error) => errors.push(error.message),
    });

    await fs.writeFile(file, "{ this is not: valid yaml: at all }", "utf-8");
    await until(() => errors.length > 0);

    // Still answering, and answering correctly.
    expect(store.current.teams.size).toBe(1);
    expect(store.current.teams.get("team-a")!.doc.info.name).toBe("team-a");
  });

  it("recovers once the document is valid again", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file] });
    await store.load();

    const errors: string[] = [];
    const reloads: number[] = [];
    watcher = watchOrgGraph({
      store,
      watchPaths: [tmpDir],
      debounceMs: 10,
      onReload: (graph) => reloads.push(graph.teams.size),
      onError: (error) => errors.push(error.message),
    });

    await fs.writeFile(file, "{{{ broken", "utf-8");
    await until(() => errors.length > 0);

    await fs.writeFile(file, teamDoc("team-a", { info: { name: "Fixed", type: "platform" } }), "utf-8");
    await until(() => reloads.length > 0);
    expect(store.current.teams.get("team-a")!.doc.info.name).toBe("Fixed");
  });

  it("coalesces a burst of events into one reload", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file], allowPartial: true });
    await store.load();

    let reloads = 0;
    watcher = watchOrgGraph({ store, watchPaths: [tmpDir], debounceMs: 60, onReload: () => reloads++ });

    // An editor save is several events; so is any loop that touches a file repeatedly.
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(file, teamDoc("team-a", { info: { name: `v${i}`, type: "platform" } }), "utf-8");
    }
    await until(() => reloads > 0);
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(reloads).toBe(1);
    expect(store.current.teams.get("team-a")!.doc.info.name).toBe("v4");
  });

  it("ignores churn in .git and in files that are not documents", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file], allowPartial: true });
    await store.load();

    let reloads = 0;
    watcher = watchOrgGraph({ store, watchPaths: [tmpDir], debounceMs: 20, onReload: () => reloads++ });

    await fs.mkdir(path.join(tmpDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".git", "index"), "whatever", "utf-8");
    await fs.writeFile(path.join(tmpDir, "README.md"), "# not a team", "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(reloads).toBe(0);
  });

  it("exposes an explicit reload for signal handlers and HTTP triggers", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file], allowPartial: true });
    await store.load();

    watcher = watchOrgGraph({ store, watchPaths: [], debounceMs: 10 });

    await fs.writeFile(file, teamDoc("team-a", { info: { name: "Manual", type: "platform" } }), "utf-8");
    await watcher.reload();

    expect(store.current.teams.get("team-a")!.doc.info.name).toBe("Manual");
  });

  it("reports an unwatchable path instead of throwing out of the server that asked for it", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file], allowPartial: true });
    await store.load();

    const errors: string[] = [];
    watcher = watchOrgGraph({
      store,
      watchPaths: [path.join(tmpDir, "does-not-exist")],
      onError: (error) => errors.push(error.message),
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Cannot watch");
  });

  it("stops reloading once closed", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file], allowPartial: true });
    await store.load();

    let reloads = 0;
    const local = watchOrgGraph({ store, watchPaths: [tmpDir], debounceMs: 10, onReload: () => reloads++ });
    local.close();

    await fs.writeFile(file, teamDoc("team-a", { info: { name: "After close", type: "platform" } }), "utf-8");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(reloads).toBe(0);
    expect(store.current.teams.get("team-a")!.doc.info.name).toBe("team-a");
  });

  it("serialises overlapping reloads so the newest result is the one that sticks", async () => {
    const file = await writeTeam("team-a");
    const store = new OrgGraphStore({ seedUris: [file], allowPartial: true });
    await store.load();

    const order: string[] = [];
    const reloadSpy = vi.spyOn(store, "reload");
    reloadSpy.mockImplementation(async function (this: OrgGraphStore, seeds?: string[]) {
      order.push("start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("end");
      return OrgGraphStore.prototype.load.call(this, seeds);
    });

    watcher = watchOrgGraph({ store, watchPaths: [], debounceMs: 1 });
    await Promise.all([watcher.reload(), watcher.reload(), watcher.reload()]);

    // Never two starts in a row: each reload finishes before the next begins.
    expect(order).toEqual(["start", "end", "start", "end", "start", "end"]);
  });
});
