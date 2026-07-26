import type { OrgGraph, TeamId } from "../model/org-graph";

/**
 * Detects drift between the declared org graph and PagerDuty.
 *
 * Ownership without escalation is half an answer. "Who owns `checkout-api`" at three in the
 * morning means the rotation, not the org chart — and those two drift apart quietly, because
 * PagerDuty is usually edited during an incident and `teamapi.yml` is edited in review.
 *
 * Read-only in both directions, like every other drift check here: it reports, a human decides.
 *
 * Four kinds of finding:
 *
 * - `unresponsive` — a declared service exists in PagerDuty with no escalation policy, or one
 *   with nobody on it. Blocking: the service is monitored and nobody is paged, which is worse
 *   than not monitoring it at all, because the alert looks handled.
 * - `unmonitored` — a declared service with nothing in PagerDuty. A warning, not an error: plenty
 *   of declared services are libraries nobody should be paged for.
 * - `undeclared` — a PagerDuty service no `teamapi.yml` claims. Someone is on call for something
 *   the org chart doesn't know exists.
 * - `misattributed` — the escalation policy doesn't name the team that declares the service. A
 *   warning, since policy naming is a convention rather than a contract.
 */

export interface PagerDutyEscalationPolicy {
  id: string;
  name: string;
  /** Number of responders across every rule. Zero means the page goes nowhere. */
  responderCount: number;
}

export interface PagerDutyService {
  id: string;
  name: string;
  escalationPolicy?: PagerDutyEscalationPolicy;
}

export type PagerDutyDriftKind = "unresponsive" | "unmonitored" | "undeclared" | "misattributed";

export interface PagerDutyDriftFinding {
  kind: PagerDutyDriftKind;
  severity: "warning" | "blocking";
  teamId?: TeamId;
  service: string;
  detail: string;
}

export interface PagerDutyDriftReport {
  findings: PagerDutyDriftFinding[];
  /** Declared services with a policy and someone on it — the healthy case. */
  matched: number;
}

/** PagerDuty service names rarely match a slug exactly, so compare loosely: case, spaces,
 * underscores and hyphens all collapse. `Checkout API` and `checkout-api` are the same service. */
export function normaliseServiceName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, "");
}

function mentionsTeam(policyName: string, teamId: TeamId, teamName: string): boolean {
  const haystack = normaliseServiceName(policyName);
  return haystack.includes(normaliseServiceName(teamId)) || haystack.includes(normaliseServiceName(teamName));
}

export function planPagerDutyDrift(graph: OrgGraph, live: PagerDutyService[]): PagerDutyDriftReport {
  const byName = new Map(live.map((s) => [normaliseServiceName(s.name), s]));
  const claimed = new Set<string>();
  const findings: PagerDutyDriftFinding[] = [];
  let matched = 0;

  for (const teamId of [...graph.teams.keys()].sort()) {
    const team = graph.teams.get(teamId)!;
    for (const service of team.doc.services) {
      const key = normaliseServiceName(service.name);
      const found = byName.get(key);
      if (!found) {
        findings.push({
          kind: "unmonitored",
          severity: "warning",
          teamId,
          service: service.name,
          detail: `'${service.name}' is declared by ${teamId} but has no PagerDuty service`,
        });
        continue;
      }
      claimed.add(key);

      const policy = found.escalationPolicy;
      if (!policy) {
        findings.push({
          kind: "unresponsive",
          severity: "blocking",
          teamId,
          service: service.name,
          detail: `'${found.name}' has no escalation policy — a page for it reaches nobody`,
        });
        continue;
      }
      if (policy.responderCount === 0) {
        findings.push({
          kind: "unresponsive",
          severity: "blocking",
          teamId,
          service: service.name,
          detail: `'${found.name}' escalates to '${policy.name}', which has nobody on it`,
        });
        continue;
      }
      if (!mentionsTeam(policy.name, teamId, team.doc.info.name)) {
        findings.push({
          kind: "misattributed",
          severity: "warning",
          teamId,
          service: service.name,
          detail: `'${found.name}' escalates to '${policy.name}', which doesn't name ${teamId}`,
        });
      }
      matched++;
    }
  }

  for (const service of live) {
    if (claimed.has(normaliseServiceName(service.name))) continue;
    findings.push({
      kind: "undeclared",
      severity: "warning",
      service: service.name,
      detail: `'${service.name}' is in PagerDuty but no teamapi.yml declares it`,
    });
  }

  return { findings, matched };
}

const MARK: Record<PagerDutyDriftKind, string> = {
  unresponsive: "!",
  unmonitored: "-",
  undeclared: "+",
  misattributed: "~",
};

export function formatPagerDutyDrift(report: PagerDutyDriftReport): string {
  if (report.findings.length === 0) {
    return `No drift. ${report.matched} service(s) matched, each escalating to someone.`;
  }
  const lines = report.findings.map((f) => `${MARK[f.kind]} ${f.kind}: ${f.detail}`);
  const blocking = report.findings.filter((f) => f.severity === "blocking").length;
  lines.push("");
  lines.push(`${report.findings.length} finding(s), ${blocking} blocking; ${report.matched} service(s) matched.`);
  return lines.join("\n");
}
