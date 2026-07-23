import { OrgGraphStore } from "@jgalego/teamapi-core";
import { buildServer } from "@jgalego/teamapi-rest-api";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

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
  warnUnresolved(store.current);

  const app = await buildServer(store, { logger: true });
  const port = options.port ?? 3000;
  await app.listen({ port, host: "127.0.0.1" });
  console.log(`REST API listening on http://127.0.0.1:${port}`);
}
