import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { diffOrgGraphs, type OrgGraphDiff } from "../diff/diff-graph";
import { planGaps, type GapFinding } from "../gaps/plan";
import type { OrgGraph, ResolvedTeam } from "../model/org-graph";
import { checkPolicies, type PolicyFinding } from "../policy/check";
import { snapshotOrg, type OrgSnapshot } from "../history/trends";
import { ProposalError, TeamPatchSchema, type TeamPatch } from "./patch";

export interface FindingDelta<T> {
  added: T[];
  resolved: T[];
}

export interface ProposalScenario {
  teamId: string;
  patch: TeamPatch;
  baseGraph: OrgGraph;
  simulatedGraph: OrgGraph;
  diff: OrgGraphDiff;
  before: OrgSnapshot;
  after: OrgSnapshot;
  gaps: FindingDelta<GapFinding>;
  policies: FindingDelta<PolicyFinding>;
}

function cloneTeam(team: ResolvedTeam): ResolvedTeam {
  return { ...team, doc: structuredClone(team.doc) };
}

function applyPatch(team: ResolvedTeam, patch: TeamPatch): ResolvedTeam {
  const next = cloneTeam(team);
  if (patch.info) next.doc.info = { ...next.doc.info, ...patch.info };
  if (patch.cognitiveLoad) next.doc.cognitiveLoad = { ...patch.cognitiveLoad };
  if (patch.channels) next.doc.channels = structuredClone(patch.channels);
  if (patch.searchTerms) next.doc.searchTerms = structuredClone(patch.searchTerms);

  const parsed = TeamApiDocumentSchema.safeParse(next.doc);
  if (!parsed.success) throw new ProposalError(`The simulated document would not validate: ${parsed.error.message}`);
  next.doc = parsed.data;
  return next;
}

function gapKey(finding: GapFinding): string {
  return [finding.kind, finding.severity, finding.teamId, finding.subject ?? "", finding.detail].join("::");
}

function policyKey(finding: PolicyFinding): string {
  return [finding.outcome, finding.severity, finding.teamId, finding.policyId, finding.ruleKey, finding.detail].join(
    "::",
  );
}

function findingDelta<T>(before: T[], after: T[], key: (finding: T) => string): FindingDelta<T> {
  const oldKeys = new Set(before.map(key));
  const newKeys = new Set(after.map(key));
  return {
    added: after.filter((finding) => !oldKeys.has(key(finding))),
    resolved: before.filter((finding) => !newKeys.has(key(finding))),
  };
}

/**
 * Applies a dashboard-safe team patch to an immutable graph overlay and evaluates its effects.
 * No source document or graph handed to this function is mutated.
 */
export function analyzeProposalScenario(graph: OrgGraph, teamId: string, rawPatch: unknown): ProposalScenario {
  const team = graph.teams.get(teamId);
  if (!team) throw new ProposalError(`Unknown team id '${teamId}'`);

  const parsedPatch = TeamPatchSchema.safeParse(rawPatch);
  if (!parsedPatch.success) throw new ProposalError(parsedPatch.error.message);
  const patch = parsedPatch.data;

  const teams = new Map(graph.teams);
  teams.set(teamId, applyPatch(team, patch));
  const simulatedGraph: OrgGraph = {
    ...graph,
    teams,
    meta: { ...graph.meta, resolvedAt: new Date().toISOString() },
  };

  const beforeGaps = planGaps(graph).findings;
  const afterGaps = planGaps(simulatedGraph).findings;
  const beforePolicies = checkPolicies(graph).findings;
  const afterPolicies = checkPolicies(simulatedGraph).findings;

  return {
    teamId,
    patch,
    baseGraph: graph,
    simulatedGraph,
    diff: diffOrgGraphs(graph, simulatedGraph),
    before: snapshotOrg(graph),
    after: snapshotOrg(simulatedGraph),
    gaps: findingDelta(beforeGaps, afterGaps, gapKey),
    policies: findingDelta(beforePolicies, afterPolicies, policyKey),
  };
}
