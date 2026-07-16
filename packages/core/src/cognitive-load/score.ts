import type { CognitiveLoadAssessment } from "@teamapi/schema";
import type { OrgGraph, TeamId } from "../model/org-graph";

export type CognitiveLoadLabel = "sustainable" | "elevated" | "overloaded";

export interface CognitiveLoadResult {
  total: number;
  label: CognitiveLoadLabel;
  assessment: CognitiveLoadAssessment;
}

/**
 * Heuristic label derived from a 1-10x3 self-assessment. Extraneous load is weighted more
 * heavily than the total: Team Topologies treats extraneous load (avoidable overhead) as the
 * one teams should actively minimize, so a high extraneous score alone can push a team into
 * "overloaded" even when intrinsic/germane load is fine.
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
