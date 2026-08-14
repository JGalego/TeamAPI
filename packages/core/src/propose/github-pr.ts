import type { GithubClient } from "../github/client";
import { proposalBranchName, proposalPullRequest, type TeamProposal } from "./patch";

export interface ProposalRepo {
  owner: string;
  repo: string;
  /** Branch to open the pull request against. Defaults to the repository's default branch. */
  baseBranch?: string;
  /** Path of the org documents inside the repository, relative to its root. The resolver knows
   * absolute filesystem paths; this is what makes them repository paths. */
  rootDir: string;
}

export interface OpenedProposal {
  url: string;
  number: number;
  branch: string;
  path: string;
}

/** Turns the absolute path the resolver knows into the path inside the repository. */
export function repositoryPath(sourceUri: string, rootDir: string): string {
  const normalisedRoot = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalisedUri = sourceUri.replace(/\\/g, "/");
  if (!normalisedUri.startsWith(`${normalisedRoot}/`)) {
    throw new Error(`${sourceUri} is not inside the configured proposal root ${rootDir}`);
  }
  return normalisedUri.slice(normalisedRoot.length + 1);
}

/**
 * Opens a pull request carrying one team's proposed change.
 *
 * A pull request rather than a commit, and that is the whole point of the feature. The dashboard
 * becomes usable by somebody who will never open an editor, without any of the properties that
 * make git-as-source-of-truth worth having going away: the change is reviewed, it is attributable,
 * it runs CI, and it can be declined. A write path that committed to the default branch would have
 * been half the work and would have quietly turned the documents into a database with a YAML
 * export.
 *
 * Idempotent by construction: the branch name is derived from the content, so proposing the same
 * change twice lands on the same branch and updates the same pull request instead of accumulating
 * near-identical ones.
 */
export async function openTeamProposal(
  client: GithubClient,
  proposal: TeamProposal,
  repo: ProposalRepo,
  author?: string,
): Promise<OpenedProposal> {
  const path = repositoryPath(proposal.sourceUri, repo.rootDir);
  const branch = proposalBranchName(proposal.teamId, proposal.content);
  const base = repo.baseBranch ?? (await client.getDefaultBranch(repo.owner, repo.repo));

  const existing = await client.findPullRequest(repo.owner, repo.repo, branch);
  if (!(await client.branchExists(repo.owner, repo.repo, branch))) {
    const baseSha = await client.getBranchSha(repo.owner, repo.repo, base);
    await client.createBranch(repo.owner, repo.repo, branch, baseSha);
  }

  // The existing file's sha is required to update it, and is how GitHub detects that somebody else
  // changed the file since this proposal was computed — in which case it refuses, which is the
  // correct outcome: the proposal was built against content that no longer exists.
  const current = await client.getFileSha(repo.owner, repo.repo, path, branch);
  const { title, body } = proposalPullRequest(proposal, author);

  await client.putFile(repo.owner, repo.repo, {
    path,
    branch,
    message: title,
    content: proposal.content,
    sha: current,
  });

  if (existing) return { url: existing.html_url, number: existing.number, branch, path };

  const created = await client.createPullRequest(repo.owner, repo.repo, { title, body, head: branch, base });
  return { url: created.html_url, number: created.number, branch, path };
}
