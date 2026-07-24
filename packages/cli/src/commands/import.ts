import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "js-yaml";
import { GithubClient, importGithubOrg } from "@jgalego/teamapi-core";

export type ImportSource = "github-org";

export interface ImportOptions {
  token?: string;
  out: string;
}

/** Bootstraps `teamapi.yml` documents from an existing system — for now, a GitHub org's teams,
 * members, and team-owned repos — so a real org doesn't have to be hand-authored from scratch.
 * Every generated team defaults to `type: stream-aligned` with empty `roles[]`, since neither has
 * a GitHub equivalent; `teamapi validate` the output, then fill those in by hand. */
export async function runImport(_source: ImportSource, org: string, options: ImportOptions): Promise<number> {
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    console.error("A GitHub token is required: pass --token or set GITHUB_TOKEN/GH_TOKEN.");
    return 1;
  }

  const client = new GithubClient({ token });

  let imported;
  try {
    imported = await importGithubOrg(client, org);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  if (imported.length === 0) {
    console.error(`No teams found in GitHub org '${org}' (or this token lacks access to them).`);
    return 1;
  }

  for (const { teamId, document } of imported) {
    const dir = path.join(options.out, teamId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "teamapi.yml"), YAML.dump(document, { lineWidth: -1, noRefs: true }), "utf-8");
  }

  console.log(
    `Wrote ${imported.length} team(s) to ${options.out}/ — every team defaulted to type: stream-aligned with no roles[]; ` +
      "review and adjust both by hand, then run `teamapi validate`.",
  );
  return 0;
}
