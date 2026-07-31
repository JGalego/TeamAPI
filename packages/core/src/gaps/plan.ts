import type { OrgGraph, TeamId } from "../model/org-graph";

/**
 * Finds the accountability holes *between* teams rather than inside any one of them.
 *
 * Every other check in this package compares the spec to an outside system — a directory, a
 * pager, a running agent fleet. This one compares the spec to itself, because the gaps it looks
 * for are invisible from any single `teamapi.yml`: each team's document is individually valid and
 * the hole only appears once the graph is resolved. A service subscribing to an event nobody
 * publishes reads as complete from inside the subscriber. A vacant seat reads as complete from
 * inside the team that declared it; it's the two other teams reporting into it that make the
 * vacancy load-bearing.
 *
 * The dangerous findings are the ones where the declaration *looks* finished. An agent carrying
 * an `ownerId` that names nobody presents, to every downstream consumer — `AGENTS.md`, the
 * context bundle, a generated crew — exactly like an agent with a real human owner. That is the
 * same argument `okta-drift` makes about deactivated accounts: the missing name is not the
 * problem, the name that's still there is.
 *
 * Pure: no I/O, no network. It only reads the graph it is handed.
 */

export type GapKind =
  /** An `agents[]` entry whose `ownerId` names no member declared on that team. */
  | "dangling-owner"
  /** A service subscribes to an event no declared service publishes. */
  | "orphan-subscription"
  /** A service publishes an event no declared service subscribes to. */
  | "unconsumed-event"
  /** A vacant role that another team's reporting line terminates in. */
  | "vacant-load-bearing"
  /** A declares a dependency or interaction on B, and B declares nothing back. */
  | "unacknowledged"
  /** An `agents[]` entry naming no human owner at all. */
  | "unaccountable-agent";

export interface GapFinding {
  kind: GapKind;
  severity: "warning" | "blocking";
  teamId: TeamId;
  /** What the finding is about — a service, role, agent or event name. */
  subject?: string;
  detail: string;
}

export interface GapsReport {
  findings: GapFinding[];
  /** Seams that resolved cleanly: a subscription with a publisher, an agent with a real owner, a
   * cross-team edge both sides declare. The healthy case. */
  matched: number;
}

interface EventEndpoint {
  teamId: TeamId;
  service: string;
}

/** Indexes every declared `publishedEvents`/`subscribedEvents` entry across the whole graph, so
 * an event contract can be checked against every team rather than only the one being walked. */
function indexEvents(graph: OrgGraph): {
  published: Map<string, EventEndpoint[]>;
  subscribed: Map<string, EventEndpoint[]>;
} {
  const published = new Map<string, EventEndpoint[]>();
  const subscribed = new Map<string, EventEndpoint[]>();

  const add = (index: Map<string, EventEndpoint[]>, event: string, endpoint: EventEndpoint) => {
    const existing = index.get(event);
    if (existing) {
      existing.push(endpoint);
      return;
    }
    index.set(event, [endpoint]);
  };

  for (const teamId of [...graph.teams.keys()].sort()) {
    for (const service of graph.teams.get(teamId)!.doc.services) {
      const context = service.boundedContext;
      if (!context) continue;
      for (const event of context.publishedEvents ?? []) add(published, event, { teamId, service: service.name });
      for (const event of context.subscribedEvents ?? []) add(subscribed, event, { teamId, service: service.name });
    }
  }

  return { published, subscribed };
}

/** Every team id each team names in any of its own edges — the "does this team acknowledge that
 * one at all?" index. */
function outboundByTeam(graph: OrgGraph): Map<TeamId, Set<TeamId>> {
  const outbound = new Map<TeamId, Set<TeamId>>();
  for (const edge of graph.edges) {
    const existing = outbound.get(edge.from);
    if (existing) {
      existing.add(edge.to);
      continue;
    }
    outbound.set(edge.from, new Set([edge.to]));
  }
  return outbound;
}

/** Collaborations are the only interaction mode that has to be mutual. `x-as-a-service` is
 * deliberately one-directional — a platform team publishes a service and consumers help
 * themselves, so it would be wrong to expect the platform to name every consumer back — and
 * `facilitating` is coaching, which the enabling team drives. Collaboration is the high-bandwidth,
 * two-way mode Team Topologies expects both sides to have agreed to and to time-box, so one team
 * declaring it alone is real signal about a relationship the other side isn't budgeting for. */
function collaborations(graph: OrgGraph): { from: TeamId; to: TeamId }[] {
  return graph.edges
    .filter((edge) => edge.kind === "interaction" && edge.mode === "collaboration")
    .map((edge) => ({ from: edge.from, to: edge.to }));
}

export function planGaps(graph: OrgGraph): GapsReport {
  const findings: GapFinding[] = [];
  let matched = 0;

  const { published, subscribed } = indexEvents(graph);
  const outbound = outboundByTeam(graph);
  const collaborators = new Map<TeamId, TeamId[]>();
  for (const { from, to } of collaborations(graph)) {
    collaborators.set(from, [...(collaborators.get(from) ?? []), to].sort());
  }

  // Event contracts. A subscription with no publisher is a broken contract that every individual
  // document still validates against; an unconsumed publication is only a smell.
  for (const [event, subscribers] of [...subscribed.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const subscriber of subscribers) {
      if (published.has(event)) {
        matched++;
        continue;
      }
      findings.push({
        kind: "orphan-subscription",
        severity: "blocking",
        teamId: subscriber.teamId,
        subject: event,
        detail: `'${subscriber.service}' subscribes to '${event}', which no declared service publishes`,
      });
    }
  }

  for (const [event, publishers] of [...published.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (subscribed.has(event)) continue;
    for (const publisher of publishers) {
      findings.push({
        kind: "unconsumed-event",
        severity: "warning",
        teamId: publisher.teamId,
        subject: event,
        detail: `'${publisher.service}' publishes '${event}', which no declared service subscribes to`,
      });
    }
  }

  for (const teamId of [...graph.teams.keys()].sort()) {
    const doc = graph.teams.get(teamId)!.doc;

    // Agents. `ownerId` is the only place the spec names a human behind an agent, and nothing has
    // ever checked that it resolves.
    const memberIds = new Set(doc.members.map((m) => m.id));
    for (const agent of doc.agents) {
      if (!agent.ownerId) {
        findings.push({
          kind: "unaccountable-agent",
          severity: "warning",
          teamId,
          subject: agent.id,
          detail: `agent '${agent.id}' names no ownerId, so nobody on ${teamId} is accountable for it`,
        });
        continue;
      }
      if (!memberIds.has(agent.ownerId)) {
        findings.push({
          kind: "dangling-owner",
          severity: "blocking",
          teamId,
          subject: agent.id,
          detail: `agent '${agent.id}' is owned by '${agent.ownerId}', who is not a member of ${teamId}`,
        });
        continue;
      }
      matched++;
    }

    // Vacant seats that other teams report into. A vacancy inside one team is a staffing question;
    // a vacancy other teams' reporting lines terminate in is an accountability hole.
    const filled = new Set(doc.members.flatMap((m) => m.roleIds));
    for (const role of doc.roles) {
      if (filled.has(role.id)) continue;
      const incoming = graph.roleEdges.filter(
        (e) => e.kind === "reports-to" && e.toTeam === teamId && e.toRole === role.id && e.fromTeam !== teamId,
      );
      if (incoming.length === 0) continue;
      const from = [...new Set(incoming.map((e) => e.fromTeam))].sort().join(", ");
      findings.push({
        kind: "vacant-load-bearing",
        severity: "warning",
        teamId,
        subject: role.id,
        detail: `'${role.id}' on ${teamId} is vacant, but ${from} report(s) into it`,
      });
    }

    // Collaborations the other side has never heard of.
    for (const target of collaborators.get(teamId) ?? []) {
      if (outbound.get(target)?.has(teamId)) {
        matched++;
        continue;
      }
      findings.push({
        kind: "unacknowledged",
        severity: "warning",
        teamId,
        subject: target,
        detail: `${teamId} declares a collaboration with ${target}, which declares nothing back`,
      });
    }
  }

  return { findings, matched };
}

const MARK: Record<GapKind, string> = {
  "dangling-owner": "!",
  "orphan-subscription": "!",
  "unconsumed-event": "-",
  "unaccountable-agent": "-",
  unacknowledged: "~",
  "vacant-load-bearing": "?",
};

export function formatGaps(report: GapsReport): string {
  if (report.findings.length === 0) {
    return `No gaps. ${report.matched} seam(s) checked, each with someone on both sides.`;
  }
  const lines = report.findings.map((f) => `${MARK[f.kind]} ${f.kind}: ${f.detail}`);
  const blocking = report.findings.filter((f) => f.severity === "blocking").length;
  lines.push("");
  lines.push(`${report.findings.length} finding(s), ${blocking} blocking; ${report.matched} seam(s) checked.`);
  return lines.join("\n");
}
