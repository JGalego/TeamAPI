import { describe, expect, it } from "vitest";
import type { ProposalScenario } from "../propose/scenario";
import { scoreProposalImpact } from "../propose/impact-score";
import type { OrgGraph } from "../model/org-graph";

const graph: OrgGraph = {
  teams: new Map(),
  edges: [],
  roleEdges: [],
  unresolved: [],
  meta: { resolvedAt: "", sourceRoots: [] },
};

function scenario(overrides: Partial<ProposalScenario> = {}): ProposalScenario {
  return {
    teamId: "payments",
    patch: { info: { focus: "new" } },
    baseGraph: graph,
    simulatedGraph: graph,
    diff: {
      teamsAdded: [],
      teamsRemoved: [],
      teamsChanged: [],
      edgesAdded: [],
      edgesRemoved: [],
      roleEdgesAdded: [],
      roleEdgesRemoved: [],
    },
    before: {
      teams: 0,
      members: 0,
      services: 0,
      roles: 0,
      vacantRoles: 0,
      avgCognitiveLoad: 0,
      maxCognitiveLoad: 0,
      overloadedTeams: 0,
      avgSupervision: 0,
      unscoredSupervision: 0,
      agents: 0,
      activeAgents: 0,
      teamsWithAgents: 0,
      blockingGaps: 0,
      warningGaps: 0,
      teamIds: [],
    },
    after: {
      teams: 0,
      members: 0,
      services: 0,
      roles: 0,
      vacantRoles: 0,
      avgCognitiveLoad: 0,
      maxCognitiveLoad: 0,
      overloadedTeams: 0,
      avgSupervision: 0,
      unscoredSupervision: 0,
      agents: 0,
      activeAgents: 0,
      teamsWithAgents: 0,
      blockingGaps: 0,
      warningGaps: 0,
      teamIds: [],
    },
    gaps: { added: [], resolved: [] },
    policies: { added: [], resolved: [] },
    ...overrides,
  };
}

describe("scoreProposalImpact", () => {
  it("scores a no-risk proposal deterministically", () => {
    expect(scoreProposalImpact(scenario())).toEqual(scoreProposalImpact(scenario()));
    expect(scoreProposalImpact(scenario())).toMatchObject({ total: 0, risk: "low" });
  });

  it("raises risk for new blocking gaps and policy violations", () => {
    const scored = scoreProposalImpact(
      scenario({
        gaps: {
          added: [
            { kind: "unaccountable-agent", severity: "blocking", teamId: "payments", detail: "agent has no owner" },
          ],
          resolved: [],
        },
        policies: {
          added: [
            {
              outcome: "violated",
              severity: "blocking",
              teamId: "payments",
              policyId: "guardrail",
              policyName: "Guardrail",
              ruleKey: "agents_require_owner",
              detail: "agent has no owner",
            },
          ],
          resolved: [],
        },
      }),
    );

    expect(scored.total).toBeGreaterThan(0);
    expect(scored.components.accountability.evidence[0]).toContain("unaccountable-agent");
    expect(scored.components.policy.evidence[0]).toContain("guardrail");
  });

  it("caps every score at 100", () => {
    const findings = Array.from({ length: 20 }, (_, index) => ({
      kind: "unaccountable-agent" as const,
      severity: "blocking" as const,
      teamId: "payments",
      subject: `agent-${index}`,
      detail: "missing owner",
    }));
    const scored = scoreProposalImpact(scenario({ gaps: { added: findings, resolved: [] } }));
    expect(scored.components.accountability.score).toBe(100);
    expect(scored.components.agentGovernance.score).toBe(100);
    expect(scored.total).toBeLessThanOrEqual(100);
  });
});
