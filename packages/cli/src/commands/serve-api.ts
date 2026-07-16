import { OrgGraphStore } from "@teamapi/core";
import { buildServer } from "@teamapi/rest-api";
import { expandSeeds } from "../seeds";

export interface ServeApiOptions {
  port?: number;
}

export async function runServeApi(patterns: string[], options: ServeApiOptions): Promise<void> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    throw new Error(`No files matched: ${patterns.join(", ")}`);
  }

  const store = new OrgGraphStore({ seedUris: seeds, allowPartial: true });
  await store.load();

  const app = await buildServer(store, { logger: true });
  const port = options.port ?? 3000;
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`REST API listening on http://127.0.0.1:${port}`);
}
