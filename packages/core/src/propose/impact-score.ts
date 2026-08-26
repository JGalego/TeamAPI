import type { ProposalScenario } from "./scenario";

export interface ImpactScoreComponent {
  score: number;
  weight: number;
  evidence: string[];
}

export interface ProposalImpactScore {
  total: number;
  risk: "low" | "moderate" | "high" | "critical";
  components: {
    blastRadius: ImpactScoreComponent;
    accountability: ImpactScoreComponent;
    cognitiveLoad: ImpactScoreComponent;
    agentGovernance: ImpactScoreComponent;
    policy: ImpactScoreComponent;
  };
}

const weights = {
  blastRadius: 0.2,
  accountability: 0.25,
  cognitiveLoad: 0.2,
  agentGovernance: 0.15,
  policy: 0.2,
} as const;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function component(score: number, weight: number, evidence: string[]): ImpactScoreComponent {
  return { score: clamp(score), weight, evidence };
}

function risk(total: number): ProposalImpactScore["risk"] {
  if (total >= 75) return "critical";
  if (total >= 50) return "high";
  if (total >= 25) return "moderate";
  return "low";
}

/** Produces a reproducible 0-100 risk score with the facts behind every component. */
export function scoreProposalImpact(scenario: ProposalScenario): ProposalImpactScore {
  const diff = scenario.diff;
  const changedTeams = diff.teamsAdded.length + diff.teamsRemoved.length + diff.teamsChanged.length;
  const changedEdges =
    diff.edgesAdded.length + diff.edgesRemoved.length + diff.roleEdgesAdded.length + diff.roleEdgesRemoved.length;
  const teamBase = Math.max(1, scenario.baseGraph.teams.size);
  const edgeBase = Math.max(1, scenario.baseGraph.edges.length + scenario.baseGraph.roleEdges.length);

  const blastRadius = component((changedTeams / teamBase) * 70 + (changedEdges / edgeBase) * 30, weights.blastRadius, [
    `${changedTeams} of ${teamBase} teams changed`,
    `${changedEdges} of ${edgeBase} relationships changed`,
  ]);

  const newBlockingGaps = scenario.gaps.added.filter((finding) => finding.severity === "blocking");
  const newWarningGaps = scenario.gaps.added.filter((finding) => finding.severity === "warning");
  const accountability = component(
    newBlockingGaps.length * 35 + newWarningGaps.length * 15,
    weights.accountability,
    scenario.gaps.added.map((finding) => `${finding.kind}: ${finding.detail}`),
  );

  const newlyOverloaded = diff.teamsChanged.filter(
    (team) => team.cognitiveLoad?.before?.label !== "overloaded" && team.cognitiveLoad?.after?.label === "overloaded",
  );
  const maxLoadIncrease = Math.max(0, scenario.after.maxCognitiveLoad - scenario.before.maxCognitiveLoad);
  const cognitiveLoad = component(newlyOverloaded.length * 60 + maxLoadIncrease * 4, weights.cognitiveLoad, [
    ...newlyOverloaded.map((team) => `${team.teamId} becomes overloaded`),
    ...(maxLoadIncrease > 0 ? [`maximum cognitive load increases by ${maxLoadIncrease}`] : []),
  ]);

  const agentFindings = scenario.gaps.added.filter((finding) =>
    ["dangling-owner", "unaccountable-agent", "unscored-supervision"].includes(finding.kind),
  );
  const agentGovernance = component(
    agentFindings.length * 30,
    weights.agentGovernance,
    agentFindings.map((finding) => `${finding.kind}: ${finding.detail}`),
  );

  const blockingPolicies = scenario.policies.added.filter((finding) => finding.severity === "blocking");
  const warningPolicies = scenario.policies.added.filter((finding) => finding.severity === "warning");
  const policy = component(
    blockingPolicies.length * 40 + warningPolicies.length * 15,
    weights.policy,
    scenario.policies.added.map((finding) => `${finding.policyId}/${finding.ruleKey}: ${finding.detail}`),
  );

  const components = { blastRadius, accountability, cognitiveLoad, agentGovernance, policy };
  const total = clamp(Object.values(components).reduce((sum, entry) => sum + entry.score * entry.weight, 0));
  return { total, risk: risk(total), components };
}
