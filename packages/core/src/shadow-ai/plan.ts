import { agentsForbidden } from "../apply/paperclip-drift";
import type { OrgGraph, TeamId } from "../model/org-graph";
import type { ScannedRepo } from "./scan";

/**
 * Reconciles AI adoption found in repositories against what teams declare in `agents[]`.
 *
 * `paperclip-drift` already answers this question for one runtime. Most shadow AI is not in a
 * runtime — it is a `.mcp.json` somebody committed, an SDK added to a manifest, a workflow step
 * that calls a model. Those need no gateway and no adoption decision, which is exactly why they
 * spread faster than the process that is supposed to sanction them.
 *
 * What this can and cannot claim: it reports what a repository *declares*, not what anyone runs.
 * A repository with no artifacts may still have a whole team pasting into a chat window all day.
 * That limit is real and worth stating rather than papering over — the check is a floor on
 * adoption, never a ceiling.
 */

export type ShadowAiKind =
  /** AI artifacts in a repo owned by a team whose policies forbid agents. */
  | "forbidden"
  /** AI artifacts in a repo whose owning team declares no `agents[]`. */
  | "undeclared"
  /** AI artifacts in a scanned directory no team claims. */
  | "unowned"
  /** A team declares active agents, but none of its scanned repos carry a trace of them. */
  | "declared-unseen";

export interface ShadowAiFinding {
  kind: ShadowAiKind;
  severity: "warning" | "blocking";
  teamId?: TeamId;
  /** The repository the finding is about, or the team id for `declared-unseen`. */
  subject: string;
  detail: string;
}

export interface ShadowAiReport {
  findings: ShadowAiFinding[];
  /** Repos whose AI usage the owning team has declared — the healthy case. */
  matched: number;
  /** Repos scanned that carried no AI artifacts at all. Reported so a run over a tree with
   * nothing in it can't be mistaken for a clean bill of health. */
  quiet: number;
}

/** `services[].repository` is a URL; a scan produces directory names. Compare the last path
 * segment, minus any `.git`, case-insensitively — the same loose matching `pagerduty-drift` uses
 * for service names, and for the same reason: being strict here would only produce false
 * `unowned` findings for repos that are plainly declared. */
export function repoNameFromUrl(repository: string): string {
  const withoutQuery = repository.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const tail = withoutQuery.split("/").pop() ?? "";
  return tail.replace(/\.git$/i, "").toLowerCase();
}

function declaredRepos(graph: OrgGraph): Map<string, TeamId> {
  const owners = new Map<string, TeamId>();
  for (const teamId of [...graph.teams.keys()].sort()) {
    for (const service of graph.teams.get(teamId)!.doc.services) {
      if (service.repository) owners.set(repoNameFromUrl(service.repository), teamId);
    }
  }
  return owners;
}

const summarise = (repo: ScannedRepo): string => {
  const shown = repo.artifacts.slice(0, 3).map((a) => (a.detail ? `${a.path} (${a.detail})` : a.path));
  const rest = repo.artifacts.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, +${rest} more` : shown.join(", ");
};

export function planShadowAi(graph: OrgGraph, repos: ScannedRepo[]): ShadowAiReport {
  const owners = declaredRepos(graph);
  const findings: ShadowAiFinding[] = [];
  const sawArtifactsFor = new Set<TeamId>();
  const scannedTeams = new Set<TeamId>();
  let matched = 0;
  let quiet = 0;

  for (const repo of [...repos].sort((a, b) => a.name.localeCompare(b.name))) {
    const teamId = owners.get(repo.name.toLowerCase());
    if (teamId) scannedTeams.add(teamId);

    if (repo.artifacts.length === 0) {
      quiet++;
      continue;
    }

    if (!teamId) {
      findings.push({
        kind: "unowned",
        severity: "warning",
        subject: repo.name,
        detail: `'${repo.name}' carries AI artifacts (${summarise(repo)}) but no team declares the repository`,
      });
      continue;
    }

    sawArtifactsFor.add(teamId);
    const forbiddenBy = agentsForbidden(graph, teamId);
    if (forbiddenBy) {
      findings.push({
        kind: "forbidden",
        severity: "blocking",
        teamId,
        subject: repo.name,
        detail: `'${repo.name}' carries AI artifacts (${summarise(repo)}) but ${teamId}'s policy '${forbiddenBy}' forbids agents`,
      });
      continue;
    }

    if (graph.teams.get(teamId)!.doc.agents.length === 0) {
      findings.push({
        kind: "undeclared",
        severity: "warning",
        teamId,
        subject: repo.name,
        detail: `'${repo.name}' carries AI artifacts (${summarise(repo)}) but ${teamId} declares no agents[]`,
      });
      continue;
    }
    matched++;
  }

  // Only teams whose repos were actually in this scan can be judged for the reverse direction.
  for (const teamId of [...scannedTeams].sort()) {
    if (sawArtifactsFor.has(teamId)) continue;
    const active = graph.teams.get(teamId)!.doc.agents.filter((a) => a.status === "active");
    if (active.length === 0) continue;
    findings.push({
      kind: "declared-unseen",
      severity: "warning",
      teamId,
      subject: teamId,
      detail: `${teamId} declares ${active.length} active agent(s) but none of its scanned repos carry a trace of one`,
    });
  }

  return { findings, matched, quiet };
}

const MARK: Record<ShadowAiKind, string> = {
  forbidden: "!",
  "declared-unseen": "-",
  undeclared: "+",
  unowned: "?",
};

export function formatShadowAi(report: ShadowAiReport): string {
  const scanned = report.matched + report.quiet;
  if (report.findings.length === 0) {
    return `No shadow AI. ${scanned} repo(s) scanned, ${report.quiet} with no AI artifacts at all.`;
  }
  const lines = report.findings.map((f) => `${MARK[f.kind]} ${f.kind}: ${f.detail}`);
  const blocking = report.findings.filter((f) => f.severity === "blocking").length;
  lines.push("");
  lines.push(
    `${report.findings.length} finding(s), ${blocking} blocking; ${report.matched} repo(s) matched, ${report.quiet} quiet.`,
  );
  return lines.join("\n");
}
