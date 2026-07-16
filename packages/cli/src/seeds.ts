import fg from "fast-glob";

/** Expands CLI glob patterns / literal paths into a de-duplicated, sorted list of absolute file paths. */
export async function expandSeeds(patterns: string[]): Promise<string[]> {
  const matches = await fg(patterns, { absolute: true, onlyFiles: true });
  return [...new Set(matches)].sort();
}
