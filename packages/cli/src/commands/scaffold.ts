import * as fs from "node:fs/promises";
import * as YAML from "js-yaml";
import { TeamApiDocumentSchema } from "@teamapi/schema";

export interface ScaffoldOptions {
  id: string;
  name?: string;
  type: string;
  out: string;
}

export async function runScaffold(options: ScaffoldOptions): Promise<number> {
  const doc = {
    teamApiVersion: "1.0.0",
    id: options.id,
    info: {
      name: options.name ?? options.id,
      type: options.type,
      focus: "TODO: describe this team's focus",
    },
    channels: [],
    searchTerms: [],
    services: [],
    roles: [],
    members: [],
    meetings: [],
    interactions: [],
    dependencies: [],
  };

  const parsed = TeamApiDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    console.error("Scaffolded document failed validation — this is a bug in the scaffold template.");
    console.error(parsed.error.message);
    return 1;
  }

  await fs.writeFile(options.out, YAML.dump(doc, { noRefs: true }), "utf-8");
  console.log(`Wrote ${options.out}`);
  return 0;
}
