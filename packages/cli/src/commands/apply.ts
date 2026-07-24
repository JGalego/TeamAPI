import { buildOrgGraph, executeGithubTeamsApply, formatApplyPlan, GithubClient, planGithubTeamsApply } from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface ApplyOptions {
  org: string;
  token?: string;
  yes?: boolean;
}

/** Reconciles real GitHub teams/memberships in `--org` with the resolved org graph: one GitHub
 * team per Team API team (matched by slug === team id), members resolved via
 * `member.githubUsername`. Prints the plan and stops there unless `--yes` is passed — a
 * `terraform plan`/`apply` split, since this is the one command in the toolchain that writes to
 * a system outside the repo. */
export async function runApply(patterns: string[], options: ApplyOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (!token) {
    console.error("A GitHub token is required: pass --token or set GITHUB_TOKEN/GH_TOKEN.");
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  const client = new GithubClient({ token });

  let plan;
  try {
    plan = await planGithubTeamsApply(graph, client, options.org);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  console.log(formatApplyPlan(plan));

  const hasChanges = plan.teams.some((entry) => entry.action !== "noop");
  if (!hasChanges) return 0;

  if (!options.yes) {
    console.log("\nRe-run with --yes to apply this plan.");
    return 0;
  }

  try {
    await executeGithubTeamsApply(plan, graph, client);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  console.log("\nApplied.");
  return 0;
}
