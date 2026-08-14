import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** What a cache entry remembers about a fetch, so the next one can be conditional. */
export interface HttpCacheEntry {
  url: string;
  body: string;
  etag?: string;
  lastModified?: string;
  /** Epoch milliseconds. Compared against `maxAgeMs` to decide whether to revalidate at all. */
  fetchedAt: number;
}

export interface HttpCacheOptions {
  /** Cache root. Defaults to `.teamapi-cache/http` under the current working directory. */
  dir?: string;
  /**
   * How long an entry is served without contacting the server at all. Zero means always
   * revalidate — which is still far cheaper than a full fetch when the server supports ETags,
   * because a 304 carries no body.
   */
  maxAgeMs?: number;
}

export const DEFAULT_CACHE_DIR = path.join(".teamapi-cache", "http");

/** Five minutes: long enough that resolving twice in one CI job is one fetch, short enough that
 * nobody is served a stale org for a meaningful length of time. */
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * A content-addressed on-disk cache for remote Team API documents.
 *
 * The in-memory cache on `HttpLoader` already collapses repeated fetches *within* a run. What it
 * cannot help with is the shape an org at scale actually has: hundreds of documents behind
 * `https://` refs, re-resolved on every CI job, every `teamapi validate` in a pre-commit hook,
 * every server reload. Each of those pays the full download again.
 *
 * Entries are keyed by the SHA-256 of the URL rather than by a sanitized filename: URLs contain
 * characters filesystems reject, are longer than several filesystems' name limits, and — the one
 * that actually bites — sanitizing collides, so two different documents can end up sharing a file.
 *
 * The cache is advisory in both directions. A read that fails for any reason (missing, corrupt,
 * unreadable) resolves to `undefined` and the caller fetches; a write that fails is swallowed. A
 * cache is a speed-up, and a build that fails because its cache directory is read-only would be a
 * worse outcome than a slow one.
 */
export class HttpDocumentCache {
  private readonly dir: string;
  private readonly maxAgeMs: number;

  constructor(options: HttpCacheOptions = {}) {
    this.dir = options.dir ?? DEFAULT_CACHE_DIR;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  }

  private fileFor(url: string): string {
    return path.join(this.dir, `${crypto.createHash("sha256").update(url).digest("hex")}.json`);
  }

  async read(url: string): Promise<HttpCacheEntry | undefined> {
    try {
      const raw = await fs.readFile(this.fileFor(url), "utf-8");
      const entry = JSON.parse(raw) as HttpCacheEntry;
      // The URL is stored inside the entry as well as hashed into its name, so a hash collision
      // (or a hand-edited cache directory) serves nothing rather than serving the wrong document.
      if (entry.url !== url || typeof entry.body !== "string") return undefined;
      return entry;
    } catch {
      return undefined;
    }
  }

  async write(entry: HttpCacheEntry): Promise<void> {
    try {
      const file = this.fileFor(entry.url);
      await fs.mkdir(path.dirname(file), { recursive: true });
      // Written to a sibling and renamed, so a process killed mid-write leaves the previous entry
      // intact rather than a truncated one that every later run has to detect and discard.
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, JSON.stringify(entry), "utf-8");
      await fs.rename(temp, file);
    } catch {
      // Advisory: see the class comment.
    }
  }

  /** Whether an entry is young enough to serve without asking the server anything. */
  isFresh(entry: HttpCacheEntry, now = Date.now()): boolean {
    return now - entry.fetchedAt < this.maxAgeMs;
  }

  /** The conditional-request headers for an entry, empty when it carries no validators. */
  revalidationHeaders(entry: HttpCacheEntry): Record<string, string> {
    const headers: Record<string, string> = {};
    if (entry.etag) headers["If-None-Match"] = entry.etag;
    if (entry.lastModified) headers["If-Modified-Since"] = entry.lastModified;
    return headers;
  }

  /** Removes the whole cache directory. Exposed for `teamapi` tooling and tests, not used in
   * resolution — nothing here expires entries on its own, since they are revalidated instead. */
  async clear(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }
}
