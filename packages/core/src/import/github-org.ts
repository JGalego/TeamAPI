import type { GithubClient } from "../github/client";

export interface ImportedTeam {
  teamId: string;
  /** A plain object shaped like a `TeamApiDocument` — intentionally unvalidated here so an
   * import that hits an edge case still produces a document a human can inspect and fix, rather
   * than aborting the whole run. `teamapi validate` is the next step after writing these out. */
  document: Record<string, unknown>;
}

/**
 * Bootstraps one `TeamApiDocument`-shaped object per GitHub team in `org`: members (resolved to
 * real names/emails where GitHub exposes them), and services inferred from the team's repos.
 * GitHub teams carry no Team Topologies typing or role hierarchy, so every team defaults to
 * `type: stream-aligned` with empty `roles[]` — both are meant to be reviewed and corrected by
 * hand after import, not taken as ground truth.
 */
export async function importGithubOrg(
  client: Pick<GithubClient, "listOrgTeams" | "listTeamMembers" | "listTeamRepos" | "getUser">,
  org: string,
): Promise<ImportedTeam[]> {
  const teams = [...(await client.listOrgTeams(org))].sort((a, b) => a.slug.localeCompare(b.slug));

  const results: ImportedTeam[] = [];
  for (const team of teams) {
    const [members, repos] = await Promise.all([client.listTeamMembers(org, team.slug), client.listTeamRepos(org, team.slug)]);

    const sortedMembers = [...members].sort((a, b) => a.login.localeCompare(b.login));
    const enrichedMembers = await Promise.all(
      sortedMembers.map(async (member) => {
        const profile = await client.getUser(member.login).catch(() => undefined);
        return {
          id: member.login.toLowerCase(),
          name: profile?.name || member.login,
          ...(profile?.email ? { contact: profile.email } : {}),
          githubUsername: member.login,
          roleIds: [],
        };
      }),
    );

    const sortedRepos = [...repos].sort((a, b) => a.name.localeCompare(b.name));

    const document: Record<string, unknown> = {
      teamApiVersion: "1.0.0",
      id: team.slug,
      info: {
        name: team.name,
        ...(team.description ? { focus: team.description } : {}),
        type: "stream-aligned",
      },
      roles: [],
      members: enrichedMembers,
      ...(sortedRepos.length > 0
        ? { services: sortedRepos.map((repo) => ({ name: repo.name, repository: repo.html_url })) }
        : {}),
    };

    results.push({ teamId: team.slug, document });
  }

  return results;
}
