import type { DiagramModel } from "./diagram-model";
import type { OrgRecommendation } from "../recommendations/engine";

/** Visualizes recommendation pressure by connecting each affected team to its proposed actions. */
export function buildRecommendationDiagram(recommendations: OrgRecommendation[]): DiagramModel {
  const teamIds = [...new Set(recommendations.flatMap((entry) => entry.teamIds))].sort();
  return {
    title: "Evidence-backed organization recommendations",
    direction: "LR",
    nodes: [
      ...teamIds.map((teamId) => ({ id: `team:${teamId}`, label: teamId, kind: "team" })),
      ...recommendations.map((entry) => ({
        id: entry.id,
        label: `${entry.priority.toUpperCase()} · ${entry.title}\n${entry.evidenceIds.length} evidence item(s)`,
        kind: `risk-${entry.priority}`,
      })),
    ],
    edges: recommendations.flatMap((entry) =>
      entry.teamIds.map((teamId) => ({
        id: `${teamId}:${entry.id}`,
        from: `team:${teamId}`,
        to: entry.id,
        label: entry.category,
        style: entry.priority === "critical" || entry.priority === "high" ? ("solid" as const) : ("dashed" as const),
      })),
    ),
  };
}
