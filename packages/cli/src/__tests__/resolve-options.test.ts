import { describe, expect, it } from "vitest";
import { resolveOptions } from "../resolve-options";

const SEEDS = ["/org/a/teamapi.yml", "/org/b/teamapi.yml"];

describe("resolveOptions", () => {
  it("resolves partially, with the on-disk cache on by default", () => {
    expect(resolveOptions(SEEDS, {})).toEqual({
      seedUris: SEEDS,
      allowPartial: true,
      concurrency: undefined,
      cache: { dir: undefined },
    });
  });

  it("honours TEAMAPI_CACHE_DIR", () => {
    expect(resolveOptions(SEEDS, { TEAMAPI_CACHE_DIR: "/ci/cache" }).cache).toEqual({ dir: "/ci/cache" });
  });

  it("treats an empty TEAMAPI_CACHE_DIR as unset rather than as the current directory", () => {
    expect(resolveOptions(SEEDS, { TEAMAPI_CACHE_DIR: "" }).cache).toEqual({ dir: undefined });
  });

  it("disables the cache entirely with TEAMAPI_NO_CACHE", () => {
    expect(resolveOptions(SEEDS, { TEAMAPI_NO_CACHE: "1" }).cache).toBeUndefined();
  });

  it("honours TEAMAPI_RESOLVE_CONCURRENCY", () => {
    expect(resolveOptions(SEEDS, { TEAMAPI_RESOLVE_CONCURRENCY: "4" }).concurrency).toBe(4);
  });

  it("ignores a nonsensical concurrency rather than resolving with it", () => {
    // A typo'd value must fall back to the default, not to 0 (nothing in flight, so nothing ever
    // resolves) or NaN (which `Math.max` would carry straight through).
    for (const value of ["0", "-2", "banana", "1.5"]) {
      expect(resolveOptions(SEEDS, { TEAMAPI_RESOLVE_CONCURRENCY: value }).concurrency).toBeUndefined();
    }
  });
});
