import type { ContextMappingPattern, InteractionMode } from "@jgalego/teamapi-schema";
import type { GraphEdge, OrgGraph, TeamId } from "../model/org-graph";
import { MODE_TO_PATTERN_HEURISTIC } from "./patterns";

export interface ContextMapRelationship {
  from: TeamId;
  to: TeamId;
  mode: InteractionMode;
  pattern?: ContextMappingPattern;
  source: "explicit" | "heuristic";
  purpose?: string;
}

export interface ContextMapConflict {
  teamA: TeamId;
  teamB: TeamId;
  description: string;
}

export interface ContextMap {
  relationships: ContextMapRelationship[];
  conflicts: ContextMapConflict[];
}

type InteractionEdge = Extract<GraphEdge, { kind: "interaction" }>;

/**
 * Derives a DDD-style context map from the org graph's interaction edges. Each team's
 * declaration is treated as an independent directed edge — Team A's file and Team B's file may
 * genuinely disagree about mode/pattern, and reconciling that silently would hide real
 * organizational signal, so disagreements surface as `conflicts` instead.
 */
export function deriveContextMap(graph: OrgGraph, scopeTeamId?: TeamId): ContextMap {
  const interactionEdges = graph.edges.filter((e): e is InteractionEdge => e.kind === "interaction");
  const scoped = scopeTeamId
    ? interactionEdges.filter((e) => e.from === scopeTeamId || e.to === scopeTeamId)
    : interactionEdges;

  const relationships: ContextMapRelationship[] = scoped.map((edge) => ({
    from: edge.from,
    to: edge.to,
    mode: edge.mode,
    pattern: edge.contextMappingPattern ?? MODE_TO_PATTERN_HEURISTIC[edge.mode],
    source: edge.contextMappingPattern ? "explicit" : "heuristic",
    purpose: edge.purpose,
  }));

  return { relationships, conflicts: detectConflicts(interactionEdges) };
}

function detectConflicts(edges: InteractionEdge[]): ContextMapConflict[] {
  const byPair = new Map<string, InteractionEdge[]>();
  for (const edge of edges) {
    const key = [edge.from, edge.to].sort().join("::");
    const group = byPair.get(key) ?? [];
    group.push(edge);
    byPair.set(key, group);
  }

  const conflicts: ContextMapConflict[] = [];
  for (const [key, group] of byPair) {
    if (group.length < 2) continue;
    const [teamA, teamB] = key.split("::") as [TeamId, TeamId];

    const modes = new Set(group.map((e) => e.mode));
    if (modes.size > 1) {
      conflicts.push({
        teamA,
        teamB,
        description: `Declared with differing interaction modes: ${[...modes].join(", ")}`,
      });
    }

    // Two teams can agree on `mode` while still declaring genuinely conflicting DDD patterns
    // (e.g. one side says `SharedKernel`, the other `Conformist`) — that disagreement is just as
    // real a signal as a differing `mode`, so it's checked independently rather than folded into
    // the mode comparison above.
    const patterns = new Set(group.map((e) => e.contextMappingPattern).filter((p): p is NonNullable<typeof p> => !!p));
    if (patterns.size > 1) {
      conflicts.push({
        teamA,
        teamB,
        description: `Declared with differing context-mapping patterns: ${[...patterns].join(", ")}`,
      });
    }
  }
  return conflicts;
}
