import * as fs from "node:fs";
import type { OrgGraphStore } from "./store";
import type { OrgGraph } from "../model/org-graph";

export interface WatchOrgGraphOptions {
  store: OrgGraphStore;
  /** Directories to watch recursively. Usually the directories the seed files were found under. */
  watchPaths: string[];
  /**
   * Re-run seed discovery before each reload, so a team document *added* after startup is picked
   * up rather than ignored. Without it, watching would only ever notice edits to the set of files
   * that happened to exist when the process started — which is the case a growing org hits first.
   */
  resolveSeeds?: () => Promise<string[]>;
  /** Coalescing window for filesystem events. */
  debounceMs?: number;
  onReload?: (graph: OrgGraph) => void;
  onError?: (error: Error) => void;
}

export interface OrgGraphWatcher {
  /** Reload now, outside the watch loop — for a signal handler or an HTTP trigger. */
  reload: () => Promise<void>;
  close: () => void;
}

/**
 * Editors do not save a file once. They write a temp file, rename it over the target, and touch
 * the mtime — several events for one logical change, and a reader that acts on the first one
 * frequently reads a half-written file. Anything below this and a single save reloads the graph
 * two or three times; much above it and a save feels unresponsive.
 */
const DEFAULT_DEBOUNCE_MS = 150;

/** Only these ever change the resolved graph, and a `.git` directory churns constantly during
 * ordinary git operations — watching it would mean reloading on every branch switch and index
 * update, none of which imply the documents changed. */
function isRelevant(filename: string | null): boolean {
  if (!filename) return true; // some platforms omit the name; reloading is the safe assumption
  const normalized = filename.replace(/\\/g, "/");
  if (normalized.includes("/.git/") || normalized.startsWith(".git/")) return false;
  return normalized.endsWith(".yml") || normalized.endsWith(".yaml");
}

/**
 * Keeps a long-running server's `OrgGraphStore` current with the files behind it.
 *
 * The failure mode this is built around is not "a reload was missed" but "a reload was taken from
 * a file mid-write". A document saved by an editor is briefly truncated or absent, and a reload
 * landing in that window resolves an org that is missing teams — or empty. So a failed reload is
 * never allowed to replace a working graph: `OrgGraphStore.load()` only assigns after
 * `buildOrgGraph` resolves, so a throw leaves the previous graph in place, and the error is
 * reported rather than swallowed. The server keeps answering from the last good state, which is
 * always a better answer than a half-parsed one.
 */
export function watchOrgGraph(options: WatchOrgGraphOptions): OrgGraphWatcher {
  const { store, watchPaths, resolveSeeds, onReload, onError } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const watchers: fs.FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  /** Serialises reloads: two overlapping `buildOrgGraph` runs could otherwise resolve in the
   * opposite order they started and leave the store holding the older graph. */
  let inFlight: Promise<void> = Promise.resolve();

  const reload = (): Promise<void> => {
    inFlight = inFlight.then(async () => {
      if (closed) return;
      try {
        const seeds = resolveSeeds ? await resolveSeeds() : undefined;
        const graph = await store.reload(seeds);
        onReload?.(graph);
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return inFlight;
  };

  const schedule = (filename: string | null) => {
    if (!isRelevant(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void reload();
    }, debounceMs);
    // Don't hold the event loop open on the debounce timer alone: a process whose only remaining
    // work is a pending reload should still be able to exit.
    timer.unref?.();
  };

  const reportWatchError = (watchPath: string, error: unknown) => {
    onError?.(
      new Error(`Cannot watch ${watchPath}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      }),
    );
  };

  for (const watchPath of watchPaths) {
    if (!fs.existsSync(watchPath)) {
      reportWatchError(watchPath, new Error("path does not exist"));
      continue;
    }
    try {
      const watcher = fs.watch(watchPath, { recursive: true }, (_event, filename) => schedule(filename));
      watcher.on("error", (error) => reportWatchError(watchPath, error));
      watchers.push(watcher);
    } catch (error) {
      // A path that cannot be watched (permissions, a platform without recursive watch) must not
      // take down the server it was meant to keep fresh — the API still serves, just statically.
      reportWatchError(watchPath, error);
    }
  }

  return {
    reload,
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}
