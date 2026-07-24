import { scoreCognitiveLoad } from "../cognitive-load/score";
import type { GraphEdge, OrgGraph, RoleGraphEdge, TeamId } from "../model/org-graph";

export interface CognitiveLoadSnapshot {
  total: number;
  label: string;
}

export interface TeamDiff {
  teamId: TeamId;
  /** Present only when the cognitive-load total/label actually changed (including a team
   * gaining or losing an assessment entirely). */
  cognitiveLoad?: { before?: CognitiveLoadSnapshot; after?: CognitiveLoadSnapshot };
  rolesAdded: string[];
  rolesRemoved: string[];
  membersAdded: string[];
  membersRemoved: string[];
  servicesAdded: string[];
  servicesRemoved: string[];
}

export interface EdgeDiffEntry {
  kind: GraphEdge["kind"];
  from: TeamId;
  to: TeamId;
  /** The interaction mode / dependency type, or "platform" — whatever distinguishes this edge. */
  detail: string;
}

export interface RoleEdgeDiffEntry {
  kind: RoleGraphEdge["kind"];
  fromTeam: TeamId;
  fromRole: string;
  toTeam: TeamId;
  toRole: string;
}

export interface OrgGraphDiff {
  teamsAdded: TeamId[];
  teamsRemoved: TeamId[];
  /** Only teams present on both sides with at least one actual change — a same-shape team on
   * both sides is not included, to keep the diff signal-only. */
  teamsChanged: TeamDiff[];
  edgesAdded: EdgeDiffEntry[];
  edgesRemoved: EdgeDiffEntry[];
  roleEdgesAdded: RoleEdgeDiffEntry[];
  roleEdgesRemoved: RoleEdgeDiffEntry[];
}

function edgeDetail(edge: GraphEdge): string {
  if (edge.kind === "interaction") return edge.mode;
  if (edge.kind === "dependency") return edge.type;
  return "platform";
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.kind}::${edge.from}::${edge.to}::${edgeDetail(edge)}`;
}

function roleEdgeKey(edge: RoleGraphEdge): string {
  return `${edge.kind}::${edge.fromTeam}::${edge.fromRole}::${edge.toTeam}::${edge.toRole}`;
}

function setDiff(before: Iterable<string>, after: Iterable<string>): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: [...afterSet].filter((v) => !beforeSet.has(v)).sort(),
    removed: [...beforeSet].filter((v) => !afterSet.has(v)).sort(),
  };
}

function diffTeam(teamId: TeamId, oldGraph: OrgGraph, newGraph: OrgGraph): TeamDiff | undefined {
  const oldTeam = oldGraph.teams.get(teamId)!;
  const newTeam = newGraph.teams.get(teamId)!;

  const roles = setDiff(
    oldTeam.doc.roles.map((r) => r.id),
    newTeam.doc.roles.map((r) => r.id),
  );
  const members = setDiff(
    oldTeam.doc.members.map((m) => m.id),
    newTeam.doc.members.map((m) => m.id),
  );
  const services = setDiff(
    oldTeam.doc.services.map((s) => s.name),
    newTeam.doc.services.map((s) => s.name),
  );

  const oldLoad = oldTeam.doc.cognitiveLoad ? scoreCognitiveLoad(oldTeam.doc.cognitiveLoad) : undefined;
  const newLoad = newTeam.doc.cognitiveLoad ? scoreCognitiveLoad(newTeam.doc.cognitiveLoad) : undefined;
  const loadChanged = oldLoad?.total !== newLoad?.total || oldLoad?.label !== newLoad?.label;

  const hasChanges =
    roles.added.length > 0 ||
    roles.removed.length > 0 ||
    members.added.length > 0 ||
    members.removed.length > 0 ||
    services.added.length > 0 ||
    services.removed.length > 0 ||
    loadChanged;

  if (!hasChanges) return undefined;

  return {
    teamId,
    ...(loadChanged
      ? {
          cognitiveLoad: {
            before: oldLoad ? { total: oldLoad.total, label: oldLoad.label } : undefined,
            after: newLoad ? { total: newLoad.total, label: newLoad.label } : undefined,
          },
        }
      : {}),
    rolesAdded: roles.added,
    rolesRemoved: roles.removed,
    membersAdded: members.added,
    membersRemoved: members.removed,
    servicesAdded: services.added,
    servicesRemoved: services.removed,
  };
}

/**
 * Diffs two resolved org graphs — typically "the org as of some past git revision" vs. "the org
 * right now" — team-by-team and edge-by-edge. Built for `teamapi diff`, but independent of git:
 * callers can build `oldGraph`/`newGraph` from any two sources (two directories, two branches,
 * whatever `buildOrgGraph` accepts).
 */
export function diffOrgGraphs(oldGraph: OrgGraph, newGraph: OrgGraph): OrgGraphDiff {
  const oldIds = new Set(oldGraph.teams.keys());
  const newIds = new Set(newGraph.teams.keys());

  const teamsAdded = [...newIds].filter((id) => !oldIds.has(id)).sort();
  const teamsRemoved = [...oldIds].filter((id) => !newIds.has(id)).sort();
  const teamsChanged = [...oldIds]
    .filter((id) => newIds.has(id))
    .sort()
    .map((id) => diffTeam(id, oldGraph, newGraph))
    .filter((d): d is TeamDiff => d !== undefined);

  const oldEdges = new Map(oldGraph.edges.map((e) => [edgeKey(e), e]));
  const newEdges = new Map(newGraph.edges.map((e) => [edgeKey(e), e]));
  const toEntry = (e: GraphEdge): EdgeDiffEntry => ({ kind: e.kind, from: e.from, to: e.to, detail: edgeDetail(e) });
  const edgesAdded = [...newEdges.entries()].filter(([k]) => !oldEdges.has(k)).map(([, e]) => toEntry(e));
  const edgesRemoved = [...oldEdges.entries()].filter(([k]) => !newEdges.has(k)).map(([, e]) => toEntry(e));

  const oldRoleEdgeKeys = new Set(oldGraph.roleEdges.map(roleEdgeKey));
  const newRoleEdgeKeys = new Set(newGraph.roleEdges.map(roleEdgeKey));
  const roleEdgesAdded = newGraph.roleEdges.filter((e) => !oldRoleEdgeKeys.has(roleEdgeKey(e)));
  const roleEdgesRemoved = oldGraph.roleEdges.filter((e) => !newRoleEdgeKeys.has(roleEdgeKey(e)));

  return { teamsAdded, teamsRemoved, teamsChanged, edgesAdded, edgesRemoved, roleEdgesAdded, roleEdgesRemoved };
}

export function isEmptyDiff(diff: OrgGraphDiff): boolean {
  return (
    diff.teamsAdded.length === 0 &&
    diff.teamsRemoved.length === 0 &&
    diff.teamsChanged.length === 0 &&
    diff.edgesAdded.length === 0 &&
    diff.edgesRemoved.length === 0 &&
    diff.roleEdgesAdded.length === 0 &&
    diff.roleEdgesRemoved.length === 0
  );
}

/** Renders an `OrgGraphDiff` as a human-readable text report — what `teamapi diff` prints. */
export function formatOrgGraphDiff(diff: OrgGraphDiff): string {
  const lines: string[] = [];

  for (const id of diff.teamsAdded) lines.push(`+ team added: ${id}`);
  for (const id of diff.teamsRemoved) lines.push(`- team removed: ${id}`);
  if (diff.teamsAdded.length > 0 || diff.teamsRemoved.length > 0) lines.push("");

  for (const team of diff.teamsChanged) {
    lines.push(`~ ${team.teamId}`);
    if (team.cognitiveLoad) {
      const fmt = (s?: CognitiveLoadSnapshot) => (s ? `${s.total} (${s.label})` : "none");
      lines.push(`  cognitive load: ${fmt(team.cognitiveLoad.before)} -> ${fmt(team.cognitiveLoad.after)}`);
    }
    for (const id of team.rolesAdded) lines.push(`  + role added: ${id}`);
    for (const id of team.rolesRemoved) lines.push(`  - role removed: ${id}`);
    for (const id of team.membersAdded) lines.push(`  + member added: ${id}`);
    for (const id of team.membersRemoved) lines.push(`  - member removed: ${id}`);
    for (const name of team.servicesAdded) lines.push(`  + service added: ${name}`);
    for (const name of team.servicesRemoved) lines.push(`  - service removed: ${name}`);
    lines.push("");
  }

  if (diff.edgesAdded.length > 0 || diff.edgesRemoved.length > 0) {
    lines.push("Edges:");
    for (const e of diff.edgesAdded) lines.push(`  + ${e.kind} ${e.from} -> ${e.to} (${e.detail})`);
    for (const e of diff.edgesRemoved) lines.push(`  - ${e.kind} ${e.from} -> ${e.to} (${e.detail})`);
    lines.push("");
  }

  if (diff.roleEdgesAdded.length > 0 || diff.roleEdgesRemoved.length > 0) {
    lines.push("Role edges:");
    for (const e of diff.roleEdgesAdded) lines.push(`  + ${e.kind} ${e.fromTeam}.${e.fromRole} -> ${e.toTeam}.${e.toRole}`);
    for (const e of diff.roleEdgesRemoved) lines.push(`  - ${e.kind} ${e.fromTeam}.${e.fromRole} -> ${e.toTeam}.${e.toRole}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
