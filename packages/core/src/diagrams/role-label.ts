import type { ResolvedTeam } from "../model/org-graph";

/** Maps each `roles[].id` to the names of `members[]` currently filling it. */
export function membersByRole(team: ResolvedTeam): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const member of team.doc.members) {
    for (const roleId of member.roleIds) {
      const names = result.get(roleId) ?? [];
      names.push(member.name);
      result.set(roleId, names);
    }
  }
  return result;
}

/** Renders a role node label as "Name (Kind) — member, member" or "Name (Kind) — vacant". */
export function labelForRole(role: { name: string; kind: string }, memberNames: string[] | undefined): string {
  return memberNames?.length ? `${role.name} (${role.kind}) — ${memberNames.join(", ")}` : `${role.name} (${role.kind}) — vacant`;
}
