import type { OrgGraph, TeamId } from "../model/org-graph";

/**
 * Reconciles declared `members[]` against a directory.
 *
 * Every other check here compares the spec to a system the spec is supposed to drive. This one
 * compares it to the only system that is authoritative over it: people join, move and leave
 * whether or not anyone opens a pull request, and a team document quietly rots from the day it's
 * written.
 *
 * The dangerous finding isn't the missing name — it's the one that's still there. A deactivated
 * account listed as accountable for a service reads, to everyone downstream, as an owner.
 *
 * Read-only. A reconciler that edited `teamapi.yml` would put a second write path on the file the
 * whole project treats as the source of truth; changes belong in a pull request.
 */

export interface DirectoryUser {
  email: string;
  displayName?: string;
  /** Okta's user status. Anything other than `ACTIVE` means the account is not in use. */
  status?: string;
}

export interface DirectoryGroup {
  /** Matched to a team id, after `--group-prefix` is stripped. */
  name: string;
  members: DirectoryUser[];
}

export type OktaDriftKind = "joined" | "left" | "deactivated" | "no-group" | "unmatched";

export interface OktaDriftFinding {
  kind: OktaDriftKind;
  severity: "warning" | "blocking";
  teamId: TeamId;
  /** The person, where there is one — email for directory-side findings, member id for ours. */
  subject?: string;
  detail: string;
}

export interface OktaDriftReport {
  findings: OktaDriftFinding[];
  /** Declared members matched to an active directory account — the healthy case. */
  matched: number;
}

const norm = (email: string) => email.trim().toLowerCase();

export function planOktaDrift(
  graph: OrgGraph,
  groups: DirectoryGroup[],
  options: { groupPrefix?: string } = {},
): OktaDriftReport {
  const prefix = options.groupPrefix ?? "";
  const byTeam = new Map<string, DirectoryGroup>();
  for (const group of groups) {
    const id = prefix && group.name.startsWith(prefix) ? group.name.slice(prefix.length) : group.name;
    byTeam.set(id, group);
  }

  const findings: OktaDriftFinding[] = [];
  let matched = 0;

  for (const teamId of [...graph.teams.keys()].sort()) {
    const doc = graph.teams.get(teamId)!.doc;
    const group = byTeam.get(teamId);

    if (!group) {
      findings.push({
        kind: "no-group",
        severity: "warning",
        teamId,
        detail: `no directory group matches '${teamId}'`,
      });
      continue;
    }

    const directory = new Map(group.members.map((u) => [norm(u.email), u]));
    const declared = new Set<string>();

    for (const member of doc.members) {
      if (!member.contact) {
        findings.push({
          kind: "unmatched",
          severity: "warning",
          teamId,
          subject: member.id,
          detail: `'${member.id}' has no contact address, so it can't be reconciled either way`,
        });
        continue;
      }
      const email = norm(member.contact);
      declared.add(email);
      const user = directory.get(email);

      if (!user) {
        findings.push({
          kind: "left",
          severity: "warning",
          teamId,
          subject: member.contact,
          detail: `'${member.id}' <${member.contact}> is declared on ${teamId} but not in its directory group`,
        });
        continue;
      }
      if (user.status && user.status.toUpperCase() !== "ACTIVE") {
        findings.push({
          kind: "deactivated",
          severity: "blocking",
          teamId,
          subject: member.contact,
          detail: `'${member.id}' <${member.contact}> is ${user.status} in the directory but still listed on ${teamId}`,
        });
        continue;
      }
      matched++;
    }

    for (const user of group.members) {
      if (declared.has(norm(user.email))) continue;
      if (user.status && user.status.toUpperCase() !== "ACTIVE") continue; // not a joiner, just an old account
      findings.push({
        kind: "joined",
        severity: "warning",
        teamId,
        subject: user.email,
        detail: `${user.displayName ?? user.email} is in ${teamId}'s directory group but no member declares them`,
      });
    }
  }

  return { findings, matched };
}

const MARK: Record<OktaDriftKind, string> = {
  deactivated: "!",
  left: "-",
  joined: "+",
  "no-group": "?",
  unmatched: "~",
};

export function formatOktaDrift(report: OktaDriftReport): string {
  if (report.findings.length === 0) {
    return `No drift. ${report.matched} member(s) matched an active directory account.`;
  }
  const lines = report.findings.map((f) => `${MARK[f.kind]} ${f.kind}: ${f.detail}`);
  const blocking = report.findings.filter((f) => f.severity === "blocking").length;
  lines.push("");
  lines.push(`${report.findings.length} finding(s), ${blocking} blocking; ${report.matched} member(s) matched.`);
  return lines.join("\n");
}
