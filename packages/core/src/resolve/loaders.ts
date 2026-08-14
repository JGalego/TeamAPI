import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { HttpDocumentCache, type HttpCacheOptions } from "./http-cache";

export interface LoadedDocument {
  canonicalUri: string;
  raw: unknown;
}

export interface DocumentLoader {
  resolveUri(baseUri: string, ref: string): string;
  load(uri: string): Promise<LoadedDocument>;
}

function isHttpUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

export class FileLoader implements DocumentLoader {
  resolveUri(baseUri: string, ref: string): string {
    const baseDir = path.dirname(baseUri);
    return path.resolve(baseDir, ref);
  }

  async load(uri: string): Promise<LoadedDocument> {
    const text = await fs.readFile(uri, "utf-8");
    return { canonicalUri: uri, raw: YAML.load(text) };
  }
}

export interface HttpLoaderOptions {
  /**
   * On-disk cache for fetched documents. Omitted means memory-only, which is the right default
   * for a library: a cache directory is a side effect on someone's filesystem, and the callers
   * that want one (the CLI, the servers) can say so.
   */
  cache?: HttpDocumentCache | HttpCacheOptions;
}

function toCache(option: HttpLoaderOptions["cache"]): HttpDocumentCache | undefined {
  if (option === undefined) return undefined;
  return option instanceof HttpDocumentCache ? option : new HttpDocumentCache(option);
}

/**
 * Fetches `https://` refs with an in-memory cache keyed by canonical URL, so a document
 * referenced by multiple teams (e.g. a shared platform team) is fetched exactly once per run —
 * and, when an on-disk cache is configured, at most once per `maxAgeMs` across runs.
 */
export class HttpLoader implements DocumentLoader {
  private cache = new Map<string, Promise<LoadedDocument>>();
  private readonly disk: HttpDocumentCache | undefined;

  constructor(options: HttpLoaderOptions = {}) {
    this.disk = toCache(options.cache);
  }

  resolveUri(baseUri: string, ref: string): string {
    // `new URL(ref, baseUri)` always parses `baseUri` as a URL first, even when `ref` is already
    // absolute — so a local file referencing a remote `$ref` directly (`baseUri` is a filesystem
    // path, not a URL) would throw "Invalid URL" here despite `ref` alone being perfectly
    // resolvable. Short-circuit when `ref` doesn't need a base at all.
    if (isHttpUri(ref)) {
      return new URL(ref).toString();
    }
    return new URL(ref, baseUri).toString();
  }

  load(uri: string): Promise<LoadedDocument> {
    let pending = this.cache.get(uri);
    if (!pending) {
      pending = this.fetchAndParse(uri);
      this.cache.set(uri, pending);
    }
    return pending;
  }

  private async fetchAndParse(uri: string): Promise<LoadedDocument> {
    const cached = this.disk ? await this.disk.read(uri) : undefined;

    // A fresh entry is served without a request at all. A stale one still saves the body: the
    // conditional request comes back 304 with nothing in it whenever the document is unchanged,
    // which for org documents is nearly always.
    if (cached && this.disk!.isFresh(cached)) {
      return { canonicalUri: uri, raw: YAML.load(cached.body) };
    }

    const res = await fetch(uri, cached ? { headers: this.disk!.revalidationHeaders(cached) } : undefined);

    if (res.status === 304 && cached) {
      // Re-stamped so a document that never changes is revalidated once per `maxAgeMs` rather
      // than on every single resolution.
      await this.disk!.write({ ...cached, fetchedAt: Date.now() });
      return { canonicalUri: uri, raw: YAML.load(cached.body) };
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch ${uri}: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();
    if (this.disk) {
      await this.disk.write({
        url: uri,
        body: text,
        etag: res.headers.get("etag") ?? undefined,
        lastModified: res.headers.get("last-modified") ?? undefined,
        fetchedAt: Date.now(),
      });
    }
    return { canonicalUri: uri, raw: YAML.load(text) };
  }
}

export interface LoaderRegistryOptions {
  /** Passed through to the `HttpLoader`; see `HttpLoaderOptions.cache`. */
  cache?: HttpLoaderOptions["cache"];
}

/** Dispatches a `$ref` to the right loader by URI scheme, and resolves relative refs against their base. */
export class LoaderRegistry {
  private fileLoader = new FileLoader();
  private httpLoader: HttpLoader;

  constructor(options: LoaderRegistryOptions = {}) {
    this.httpLoader = new HttpLoader({ cache: options.cache });
  }

  private loaderFor(uri: string): DocumentLoader {
    return isHttpUri(uri) ? this.httpLoader : this.fileLoader;
  }

  resolveRef(baseUri: string, ref: string): string {
    const loader = isHttpUri(ref) ? this.httpLoader : this.loaderFor(baseUri);
    return loader.resolveUri(baseUri, ref);
  }

  async load(uri: string): Promise<LoadedDocument> {
    return this.loaderFor(uri).load(uri);
  }
}
