import type { OrgGraph, ResolvedTeam, TeamId } from "../model/org-graph";

/**
 * Names two teams both claim, where exactly one of them can win.
 *
 * The schema enforces uniqueness *within* a document — role ids, member ids, agent ids — but
 * nothing has ever checked the names that have to be unique across the whole org because a
 * consumer looks them up by name alone.
 *
 * `findServiceOwner` is the clearest case. Ask it who owns `payments-api` when two teams declare
 * a service by that name and it answers with whichever team id sorts first, deterministically and
 * silently. Every downstream consumer inherits that: `GET /services/payments-api`, the
 * `who_owns_service` MCP tool, the Slack `/whoowns` command, the generated CODEOWNERS. The other
 * team believes it owns the service, and nothing anywhere says otherwise.
 *
 * A deterministic tie-break is the right behaviour for a query that has to return something. It is
 * the wrong behaviour for the org: the ambiguity is a mistake in the documents, and the place to
 * say so is validation, once, rather than in every consumer that has to pick a winner.
 */

export type ConflictKind =
  /** Two teams declare a service with the same name. */
  | "duplicate-service"
  /** Two teams declare the same communication channel. */
  | "duplicate-channel";

export interface NameConflict {
  kind: ConflictKind;
  /** The contested name. */
  name: string;
  /** Every team claiming it, sorted — all of them, not just the losers, since which one "wins" is
   * an artifact of the tie-break rather than a fact about the org. */
  teamIds: TeamId[];
  detail: string;
}

interface Claim {
  teamId: TeamId;
  name: string;
}

/**
 * Groups claimed names, keyed case-insensitively because `findServiceOwner` matches that way — a
 * conflict that only appears at lookup time is exactly the kind this exists to surface first.
 */
function contested(claims: Claim[]): { name: string; teamIds: TeamId[] }[] {
  const groups = new Map<string, Claim[]>();
  for (const claim of claims) {
    const key = claim.name.toLowerCase();
    const existing = groups.get(key);
    if (existing) existing.push(claim);
    else groups.set(key, [claim]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => ({
      name: group[0]!.name,
      // Two entries from the *same* team are a duplicate within one document — that document's
      // own problem, not an org-wide question about who owns the name.
      teamIds: [...new Set(group.map((claim) => claim.teamId))].sort(),
    }))
    .filter((group) => group.teamIds.length > 1);
}

function claimsFrom(graph: OrgGraph, pick: (team: ResolvedTeam) => string[]): Claim[] {
  const claims: Claim[] = [];
  for (const teamId of [...graph.teams.keys()].sort()) {
    for (const name of pick(graph.teams.get(teamId)!)) claims.push({ teamId, name });
  }
  return claims;
}

export function findNameConflicts(graph: OrgGraph): NameConflict[] {
  const conflicts: NameConflict[] = [];

  for (const { name, teamIds } of contested(claimsFrom(graph, (team) => team.doc.services.map((s) => s.name)))) {
    conflicts.push({
      kind: "duplicate-service",
      name,
      teamIds,
      detail: `service '${name}' is declared by ${teamIds.join(", ")} — "who owns it" has no single answer`,
    });
  }

  const channelClaims = claimsFrom(graph, (team) => team.doc.channels.map((c) => `${c.type}:${c.name}`));
  for (const { name, teamIds } of contested(channelClaims)) {
    conflicts.push({
      kind: "duplicate-channel",
      name,
      teamIds,
      // `teamapi slack-sync` sets each declared channel's topic to name its owning team, so two
      // claims on one channel means the topic says whichever team was written last.
      detail: `channel '${name}' is declared by ${teamIds.join(", ")} — slack-sync would set its topic to whichever ran last`,
    });
  }

  return conflicts;
}

export function formatNameConflicts(conflicts: NameConflict[]): string {
  return conflicts.map((conflict) => `  - ${conflict.detail}`).join("\n");
}
