import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as YAML from "js-yaml";

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

/**
 * Fetches `https://` refs with an in-memory cache keyed by canonical URL, so a document
 * referenced by multiple teams (e.g. a shared platform team) is fetched exactly once per run.
 */
export class HttpLoader implements DocumentLoader {
  private cache = new Map<string, Promise<LoadedDocument>>();

  resolveUri(baseUri: string, ref: string): string {
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
    const res = await fetch(uri);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${uri}: ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    return { canonicalUri: uri, raw: YAML.load(text) };
  }
}

/** Dispatches a `$ref` to the right loader by URI scheme, and resolves relative refs against their base. */
export class LoaderRegistry {
  private fileLoader = new FileLoader();
  private httpLoader = new HttpLoader();

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
