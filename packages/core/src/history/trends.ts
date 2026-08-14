import type { OrgGraph, TeamId } from "../model/org-graph";
import { planGaps } from "../gaps/plan";
import { orgWideCognitiveLoadReport } from "../cognitive-load/score";

/** What the org looked like at one point in time. */
export interface OrgSnapshot {
  teams: number;
  members: number;
  services: number;
  roles: number;
  vacantRoles: number;
  /** Mean of every team that scored one. Teams that did not are excluded rather than counted as
   * zero, which would make adopting the assessment look like the load going down. */
  avgCognitiveLoad: number;
  maxCognitiveLoad: number;
  overloadedTeams: number;
  /** Mean supervision score across teams that scored one. */
  avgSupervision: number;
  /** Teams running active agents while leaving `cognitiveLoad.supervision` blank. The load exists
   * whether or not anybody scored it, and this is the number that says how much of it is invisible. */
  unscoredSupervision: number;
  agents: number;
  activeAgents: number;
  teamsWithAgents: number;
  blockingGaps: number;
  warningGaps: number;
  /** Team ids, for computing churn against the previous point. */
  teamIds: string[];
}

export interface HistoryPoint {
  sha: string;
  date: string;
  subject: string;
  snapshot: OrgSnapshot;
  /** Teams present here and not in the previous point. Empty on the first point — nothing to
   * compare against, and reporting every team as "added" would put a spike at the origin of every
   * chart. */
  teamsAdded: TeamId[];
  teamsRemoved: TeamId[];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

/** Everything a trend line needs from one resolved graph. Pure: the caller does the git work. */
export function snapshotOrg(graph: OrgGraph): OrgSnapshot {
  const teams = [...graph.teams.values()];
  const load = orgWideCognitiveLoadReport(graph);
  const gaps = planGaps(graph);

  const roles = teams.flatMap((team) => team.doc.roles.map((role) => `${team.id}/${role.id}`));
  const filled = new Set(
    teams.flatMap((team) => team.doc.members.flatMap((member) => member.roleIds.map((id) => `${team.id}/${id}`))),
  );
  const agents = teams.flatMap((team) => team.doc.agents);
  const supervisionScores = load
    .map((entry) => entry.assessment.supervision)
    .filter((value): value is number => value !== undefined);

  return {
    teams: teams.length,
    members: teams.reduce((sum, team) => sum + team.doc.members.length, 0),
    services: teams.reduce((sum, team) => sum + team.doc.services.length, 0),
    roles: roles.length,
    vacantRoles: roles.filter((key) => !filled.has(key)).length,
    avgCognitiveLoad: mean(load.map((entry) => entry.total)),
    maxCognitiveLoad: load.length > 0 ? Math.max(...load.map((entry) => entry.total)) : 0,
    overloadedTeams: load.filter((entry) => entry.label === "overloaded").length,
    avgSupervision: mean(supervisionScores),
    unscoredSupervision: gaps.findings.filter((finding) => finding.kind === "unscored-supervision").length,
    agents: agents.length,
    activeAgents: agents.filter((agent) => agent.status === "active").length,
    teamsWithAgents: teams.filter((team) => team.doc.agents.length > 0).length,
    blockingGaps: gaps.findings.filter((finding) => finding.severity === "blocking").length,
    warningGaps: gaps.findings.filter((finding) => finding.severity === "warning").length,
    teamIds: teams.map((team) => team.id).sort(),
  };
}

/** Attaches team churn to a series of snapshots, each compared against the one before it. */
export function withChurn(
  points: Array<{ sha: string; date: string; subject: string; snapshot: OrgSnapshot }>,
): HistoryPoint[] {
  return points.map((point, index) => {
    const previous = index === 0 ? undefined : points[index - 1]!.snapshot.teamIds;
    if (!previous) return { ...point, teamsAdded: [], teamsRemoved: [] };
    const before = new Set(previous);
    const after = new Set(point.snapshot.teamIds);
    return {
      ...point,
      teamsAdded: point.snapshot.teamIds.filter((id) => !before.has(id)),
      teamsRemoved: previous.filter((id) => !after.has(id)),
    };
  });
}

/** The columns a text or CSV report shows, in order, with how to read each out of a snapshot. */
const COLUMNS: Array<{ header: string; of: (snapshot: OrgSnapshot) => number }> = [
  { header: "teams", of: (s) => s.teams },
  { header: "people", of: (s) => s.members },
  { header: "services", of: (s) => s.services },
  { header: "vacant", of: (s) => s.vacantRoles },
  { header: "load~", of: (s) => s.avgCognitiveLoad },
  { header: "load^", of: (s) => s.maxCognitiveLoad },
  { header: "over", of: (s) => s.overloadedTeams },
  { header: "agents", of: (s) => s.agents },
  { header: "sup~", of: (s) => s.avgSupervision },
  { header: "unscored", of: (s) => s.unscoredSupervision },
  { header: "gaps!", of: (s) => s.blockingGaps },
];

function pad(value: string, width: number): string {
  return value.padStart(width);
}

/**
 * A fixed-width table, oldest first, with a delta line at the bottom.
 *
 * The delta is the point of the whole command. A column of numbers tells you what the org is; the
 * difference between the first and last row tells you what it is becoming, which is the question —
 * "is supervision load creeping up?" is not answerable from any single snapshot, which is exactly
 * why nobody noticed it before.
 */
export function formatHistory(points: HistoryPoint[]): string {
  if (points.length === 0) return "No revisions to report.";

  const dateWidth = 10;
  const widths = COLUMNS.map((column) =>
    Math.max(column.header.length, ...points.map((point) => String(column.of(point.snapshot)).length)),
  );

  const lines: string[] = [];
  lines.push([pad("date", dateWidth), ...COLUMNS.map((c, i) => pad(c.header, widths[i]!))].join("  "));

  for (const point of points) {
    lines.push(
      [
        pad(point.date.slice(0, 10), dateWidth),
        ...COLUMNS.map((column, i) => pad(String(column.of(point.snapshot)), widths[i]!)),
      ].join("  "),
    );
  }

  if (points.length > 1) {
    const first = points[0]!.snapshot;
    const last = points.at(-1)!.snapshot;
    lines.push("");
    lines.push(
      [
        pad("change", dateWidth),
        ...COLUMNS.map((column, i) => {
          const delta = Number((column.of(last) - column.of(first)).toFixed(2));
          return pad(delta > 0 ? `+${delta}` : String(delta), widths[i]!);
        }),
      ].join("  "),
    );

    const added = points.flatMap((point) => point.teamsAdded);
    const removed = points.flatMap((point) => point.teamsRemoved);
    if (added.length > 0) lines.push(`\nTeams added:   ${[...new Set(added)].sort().join(", ")}`);
    if (removed.length > 0) lines.push(`Teams removed: ${[...new Set(removed)].sort().join(", ")}`);
  }

  lines.push("");
  lines.push("load~/load^ = mean/max cognitive load. sup~ = mean supervision. unscored = teams running");
  lines.push("agents with no supervision score. gaps! = blocking accountability gaps.");
  return lines.join("\n");
}

/** CSV, for the spreadsheet or notebook this is eventually going to end up in anyway. */
export function historyToCsv(points: HistoryPoint[]): string {
  const header = ["date", "sha", ...COLUMNS.map((column) => column.header), "teamsAdded", "teamsRemoved"];
  const rows = points.map((point) => [
    point.date,
    point.sha.slice(0, 12),
    ...COLUMNS.map((column) => String(column.of(point.snapshot))),
    point.teamsAdded.join(" "),
    point.teamsRemoved.join(" "),
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(","))
    .join("\n");
}
