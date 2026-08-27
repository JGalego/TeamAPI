import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { TEAM_API_SCHEMA_MODELINE, TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { formatZodError } from "@jgalego/teamapi-core";

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
    // Almost always caused by a bad `<id>` (not lowercase-kebab-case) or `--type` value, since
    // every other field here is a fixed, known-valid literal — so point at the input, not at an
    // implied bug in this template.
    console.error(`Could not scaffold '${options.id}': ${formatZodError(parsed.error)}`);
    return 1;
  }

  // Prepended rather than emitted through js-yaml: `YAML.dump` has no way to write a leading
  // comment, and this has to be the first line for the language server to pick it up.
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, `${TEAM_API_SCHEMA_MODELINE}\n${YAML.dump(doc, { noRefs: true })}`, "utf-8");
  console.log(`Wrote ${options.out}`);
  return 0;
}
