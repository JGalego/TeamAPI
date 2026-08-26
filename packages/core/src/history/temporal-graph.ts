import type { OrgGraph, ResolvedTeam, TeamId } from "../model/org-graph";

export interface TemporalOrgPoint {
  sha: string;
  date: string;
  subject?: string;
  graph: OrgGraph;
}

export interface TeamLifecycleEvent {
  date: string;
  sha: string;
  kind: "created" | "removed" | "members-changed" | "roles-changed" | "services-changed";
  added: string[];
  removed: string[];
}

export interface TemporalOrgGraph {
  points: TemporalOrgPoint[];
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid temporal graph date '${value}'`);
  return parsed;
}

function ids(values: Array<{ id?: string; name?: string }>): string[] {
  return values.map((value) => value.id ?? value.name!).sort();
}

function delta(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const previous = new Set(before);
  const current = new Set(after);
  return {
    added: after.filter((value) => !previous.has(value)),
    removed: before.filter((value) => !current.has(value)),
  };
}

/** Builds an immutable, chronologically ordered view over resolved org revisions. */
export function buildTemporalOrgGraph(points: TemporalOrgPoint[]): TemporalOrgGraph {
  const ordered = [...points].sort((a, b) => timestamp(a.date) - timestamp(b.date) || a.sha.localeCompare(b.sha));
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index - 1]!.sha === ordered[index]!.sha) {
      throw new Error(`Duplicate temporal graph revision '${ordered[index]!.sha}'`);
    }
  }
  return { points: ordered };
}

/** Returns the latest known org state at or before the requested date. */
export function orgAtDate(temporal: TemporalOrgGraph, date: string | Date): TemporalOrgPoint | undefined {
  const target = date instanceof Date ? date.getTime() : timestamp(date);
  let match: TemporalOrgPoint | undefined;
  for (const point of temporal.points) {
    if (timestamp(point.date) > target) break;
    match = point;
  }
  return match;
}

export function teamAtDate(temporal: TemporalOrgGraph, teamId: TeamId, date: string | Date): ResolvedTeam | undefined {
  return orgAtDate(temporal, date)?.graph.teams.get(teamId);
}

/** Explains when a team appeared, disappeared, or changed its declared composition. */
export function teamLifecycle(temporal: TemporalOrgGraph, teamId: TeamId): TeamLifecycleEvent[] {
  const events: TeamLifecycleEvent[] = [];
  let previous: ResolvedTeam | undefined;

  for (const point of temporal.points) {
    const current = point.graph.teams.get(teamId);
    if (!previous && current) {
      events.push({ date: point.date, sha: point.sha, kind: "created", added: [teamId], removed: [] });
    } else if (previous && !current) {
      events.push({ date: point.date, sha: point.sha, kind: "removed", added: [], removed: [teamId] });
    } else if (previous && current) {
      const changes: Array<[TeamLifecycleEvent["kind"], string[], string[]]> = [
        ["members-changed", ids(previous.doc.members), ids(current.doc.members)],
        ["roles-changed", ids(previous.doc.roles), ids(current.doc.roles)],
        ["services-changed", ids(previous.doc.services), ids(current.doc.services)],
      ];
      for (const [kind, before, after] of changes) {
        const change = delta(before, after);
        if (change.added.length > 0 || change.removed.length > 0) {
          events.push({ date: point.date, sha: point.sha, kind, ...change });
        }
      }
    }
    previous = current;
  }

  return events;
}
