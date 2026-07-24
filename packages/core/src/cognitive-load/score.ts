import type { CognitiveLoadAssessment } from "@jgalego/teamapi-schema";
import type { OrgGraph, TeamId } from "../model/org-graph";

export type CognitiveLoadLabel = "sustainable" | "elevated" | "overloaded";

export interface CognitiveLoadResult {
  total: number;
  label: CognitiveLoadLabel;
  assessment: CognitiveLoadAssessment;
}

/**
 * Heuristic label derived from a 1-10x3 self-assessment. Two independent triggers decide the
 * label, and either alone is sufficient: a high `extraneous` score alone can push a team into
 * "overloaded"/"elevated" even when intrinsic/germane load is fine (Team Topologies treats
 * extraneous load — avoidable overhead — as the one teams should actively minimize), OR a high
 * `total` alone does the same regardless of composition. This means two teams with the same
 * `total` can land on the same label even when their load looks very different underlying it
 * (e.g. `intrinsic=10, extraneous=1, germane=10` and `intrinsic=1, extraneous=16, germane=1` are
 * both "overloaded" via the `total` branch, even though the first has almost no avoidable
 * overhead) — that's intentional: a team's total cognitive load matters on its own even when
 * extraneous load specifically is low, and callers wanting the underlying composition can read
 * `assessment.{intrinsic,extraneous,germane}` directly off the result rather than the label alone.
 */
export function scoreCognitiveLoad(assessment: CognitiveLoadAssessment): CognitiveLoadResult {
  const total = assessment.intrinsic + assessment.extraneous + assessment.germane;
  let label: CognitiveLoadLabel = "sustainable";
  if (assessment.extraneous >= 7 || total >= 24) {
    label = "overloaded";
  } else if (assessment.extraneous >= 4 || total >= 18) {
    label = "elevated";
  }
  return { total, label, assessment };
}

export interface TeamCognitiveLoadReport extends CognitiveLoadResult {
  teamId: TeamId;
}

export function orgWideCognitiveLoadReport(graph: OrgGraph): TeamCognitiveLoadReport[] {
  const results: TeamCognitiveLoadReport[] = [];
  for (const team of graph.teams.values()) {
    if (team.doc.cognitiveLoad) {
      results.push({ teamId: team.id, ...scoreCognitiveLoad(team.doc.cognitiveLoad) });
    }
  }
  return results.sort((a, b) => b.total - a.total);
}
