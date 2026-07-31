import type { OrgGraph, TeamId } from "../model/org-graph";

/**
 * Detects drift between the declared org graph and a running Paperclip instance.
 *
 * This is deliberately read-only. Team API's whole premise is that the YAML in git is the source
 * of truth, so this reports what diverged and leaves the decision to a human — it never writes to
 * Paperclip and never writes back into `teamapi.yml`.
 *
 * Three kinds of finding:
 *
 * - `undeclared` — an agent running in Paperclip that no `teamapi.yml` declares. The interesting
 *   case, because Paperclip's org is mutable from its UI while the spec is only mutable through
 *   review.
 * - `missing` — a declared, active agent with nothing running for it.
 * - `forbidden` — an agent running for a team whose policies say it shouldn't have one. Severity
 *   is raised because this is a governance breach rather than ordinary drift.
 */

export interface PaperclipAgent {
  id: string;
  name: string;
  role?: string;
  title?: string;
  status?: string;
  /** Set by the generator under `metadata.teamapi`; absent for hand-created agents. */
  metadata?: { teamapi?: { team?: string; agentId?: string } } & Record<string, unknown>;
}

export type DriftKind = "undeclared" | "missing" | "forbidden";

export interface DriftFinding {
  kind: DriftKind;
  severity: "warning" | "blocking";
  teamId?: TeamId;
  agentId: string;
  detail: string;
}

export interface PaperclipDriftReport {
  companyId: string;
  findings: DriftFinding[];
  /** Declared active agents matched to a running one — the healthy case. */
  matched: number;
}

/** A team whose policies forbid agents outright. Recognised by a policy id or description that
 * denies agents, e.g. acme-org's `no-agents-on-applicant-pii`.
 *
 * Exported because `shadow-ai` asks the same question of a different input: this one governs
 * agents running in Paperclip, that one governs AI artifacts committed to the team's repos, and
 * a team that has forbidden agents has forbidden both. */
export function agentsForbidden(graph: OrgGraph, teamId: TeamId): string | null {
  for (const policy of graph.teams.get(teamId)?.doc.policies ?? []) {
    const haystack = `${policy.id} ${policy.name} ${policy.description ?? ""}`.toLowerCase();
    if (/no[- ]agents?|agents?[- ]forbidden|no ai agent/.test(haystack)) {
      return policy.id;
    }
  }
  return null;
}

/** Paperclip agents carry the originating team in metadata when they came from our generator.
 * Hand-created ones don't, so fall back to matching on the scoped slug the generator emits
 * (`<team>-<agent>`) before giving up and calling it undeclared. */
function attribute(
  agent: PaperclipAgent,
  declared: Map<string, { teamId: TeamId; agentId: string }>,
): { teamId: TeamId; agentId: string } | null {
  const meta = agent.metadata?.teamapi;
  if (meta?.team && meta?.agentId) return { teamId: meta.team, agentId: meta.agentId };
  return declared.get(agent.id) ?? declared.get(agent.name) ?? null;
}

export function planPaperclipDrift(
  graph: OrgGraph,
  companyId: string,
  running: PaperclipAgent[],
): PaperclipDriftReport {
  // every active declared agent, keyed by the scoped slug the generator would give it
  const declared = new Map<string, { teamId: TeamId; agentId: string }>();
  const declaredByKey = new Map<string, { teamId: TeamId; agentId: string }>();
  for (const teamId of [...graph.teams.keys()].sort()) {
    for (const agent of graph.teams.get(teamId)!.doc.agents) {
      if (agent.status !== "active") continue;
      declared.set(`${teamId}-${agent.id}`, { teamId, agentId: agent.id });
      declaredByKey.set(`${teamId}/${agent.id}`, { teamId, agentId: agent.id });
    }
  }

  const findings: DriftFinding[] = [];
  const seen = new Set<string>();

  for (const agent of running) {
    const attributed = attribute(agent, declared);
    if (!attributed) {
      findings.push({
        kind: "undeclared",
        severity: "warning",
        agentId: agent.id,
        detail: `'${agent.name}' is running in Paperclip but no teamapi.yml declares it`,
      });
      continue;
    }
    seen.add(`${attributed.teamId}/${attributed.agentId}`);
    const forbiddenBy = agentsForbidden(graph, attributed.teamId);
    if (forbiddenBy) {
      findings.push({
        kind: "forbidden",
        severity: "blocking",
        teamId: attributed.teamId,
        agentId: attributed.agentId,
        detail: `'${agent.name}' runs for ${attributed.teamId}, whose policy '${forbiddenBy}' forbids agents`,
      });
    }
  }

  for (const key of [...declaredByKey.keys()].sort()) {
    if (seen.has(key)) continue;
    const { teamId, agentId } = declaredByKey.get(key)!;
    findings.push({
      kind: "missing",
      severity: "warning",
      teamId,
      agentId,
      detail: `${key} is declared and active but nothing is running for it`,
    });
  }

  return { companyId, findings, matched: seen.size };
}

export function formatDriftReport(report: PaperclipDriftReport): string {
  if (report.findings.length === 0) {
    return `No drift between the org graph and Paperclip company '${report.companyId}' (${report.matched} agent(s) matched).`;
  }
  const mark = { forbidden: "!", undeclared: "+", missing: "-" } as const;
  const lines = report.findings.map((f) => `${mark[f.kind]} ${f.kind}: ${f.detail}`);
  const blocking = report.findings.filter((f) => f.severity === "blocking").length;
  lines.push("");
  lines.push(`${report.findings.length} finding(s), ${blocking} blocking; ${report.matched} agent(s) matched.`);
  return lines.join("\n");
}
