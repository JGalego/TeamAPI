import type { DiagramModel } from "./diagram-model";
import { scoreProposalImpact, type ProposalImpactScore } from "../propose/impact-score";
import type { ProposalScenario } from "../propose/scenario";

/** A compact visual explanation of where a proposal's deterministic risk comes from. */
export function buildScenarioDiagram(
  scenario: ProposalScenario,
  score: ProposalImpactScore = scoreProposalImpact(scenario),
): DiagramModel {
  const components = Object.entries(score.components);
  return {
    title: `Proposal impact — ${scenario.teamId} (${score.risk}, ${score.total}/100)`,
    direction: "LR",
    nodes: [
      {
        id: "proposal",
        label: `${scenario.teamId}\n${score.risk.toUpperCase()} RISK · ${score.total}/100`,
        kind: "proposal",
      },
      ...components.map(([name, value]) => ({
        id: name,
        label: `${name.replace(/([A-Z])/g, " $1")}\n${value.score}/100`,
        kind: value.score >= 50 ? "risk-high" : value.score >= 25 ? "risk-medium" : "risk-low",
      })),
    ],
    edges: components.map(([name, value], index) => ({
      id: `impact-${index}`,
      from: "proposal",
      to: name,
      label: value.evidence.length === 0 ? "no new findings" : `${value.evidence.length} finding(s)`,
      style: value.score === 0 ? ("dotted" as const) : ("solid" as const),
    })),
  };
}
