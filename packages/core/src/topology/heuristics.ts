import { z } from "zod";
import type { DurationUnit, Interaction } from "@jgalego/teamapi-schema";
import type { OrgGraph, TeamId } from "../model/org-graph";

/**
 * The Team Topologies design smells — the ones the book is explicit about and the schema already
 * has the fields to detect.
 *
 * These are deliberately not `gaps`. A gap is an accountability hole: something nobody owns, where
 * the document looks complete and isn't. These are the opposite — everything is owned and declared,
 * and the *shape* is what's off. Mixing them would produce one report answering two questions, and
 * the answer to "what is nobody responsible for" would get lost among "your teams are too big".
 *
 * Every finding here is a warning by default, and none of them is automatically wrong: an org can
 * have a good reason for a nine-month collaboration. They're prompts for a conversation, which is
 * what Team Topologies is for. Severity overrides in the config file exist for orgs that want to
 * make one of them a gate.
 *
 * Pure: no I/O, no network.
 */

export type TopologyKind =
  /** A collaboration that has run past the duration it declared for itself. */
  | "collaboration-overrun"
  /** A collaboration with no expected duration at all. */
  | "collaboration-untimed"
  /** A team with more members than a single team can hold in its head. */
  | "team-too-large"
  /** One team in more concurrent collaborations than it can sustain. */
  | "collaboration-overload"
  /** A platform team depending on a team it is supposed to serve. */
  | "platform-depends-on-stream"
  /** A dependency the team itself has labelled as blocking it. */
  | "blocking-dependency";

export interface TopologyFinding {
  kind: TopologyKind;
  severity: "warning" | "blocking";
  teamId: TeamId;
  subject?: string;
  detail: string;
}

export interface TopologyReport {
  findings: TopologyFinding[];
  /** Teams examined, so a clean report can say what it actually checked. */
  teams: number;
}

export const TopologyConfigSchema = z
  .object({
    /**
     * Team Topologies puts a team at "no bigger than a Dunbar-limited group that can hold shared
     * context" — commonly read as 5-9. Nine is the top of that range rather than the middle,
     * because this check should fire when a team is genuinely past the point of holding context,
     * not every time it hires a seventh person.
     */
    maxTeamSize: z.number().int().positive().default(9),
    /**
     * Collaboration is the expensive mode: high bandwidth, and both teams pay for it. A team in
     * several at once is not collaborating, it's fragmenting.
     */
    maxCollaborations: z.number().int().positive().default(3),
    /**
     * Re-grades a kind, exactly as `gaps.severity` does. Present because these checks are prompts
     * for a conversation by default, and an org that has decided one of them really is a gate
     * needs to be able to say so without a second tool.
     */
    severity: z.record(z.enum(["warning", "blocking", "off"])).default({}),
  })
  .strict();
export type TopologyConfig = z.infer<typeof TopologyConfigSchema>;

export const DEFAULT_TOPOLOGY_CONFIG: TopologyConfig = { maxTeamSize: 9, maxCollaborations: 3, severity: {} };

const DAYS_PER_UNIT: Record<DurationUnit, number> = { days: 1, weeks: 7, months: 30 };

/**
 * When a time-boxed interaction was due to end, or `undefined` if it never said.
 *
 * Months are approximated at 30 days rather than by calendar arithmetic. The input is a
 * self-reported estimate of how long a collaboration should last — "about three months" — so
 * resolving whether it ended on the 28th or the 31st is precision the data doesn't have, and
 * pretending otherwise would make the check look more exact than it is.
 */
export function expectedEnd(interaction: Interaction): Date | undefined {
  if (!interaction.startDate || interaction.expectedDuration === undefined) return undefined;
  const start = new Date(interaction.startDate);
  if (Number.isNaN(start.getTime())) return undefined;
  const unit = interaction.expectedDurationUnit ?? "days";
  const days = interaction.expectedDuration * DAYS_PER_UNIT[unit];
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function checkTopology(
  graph: OrgGraph,
  config: TopologyConfig = DEFAULT_TOPOLOGY_CONFIG,
  now: Date = new Date(),
): TopologyReport {
  const findings: TopologyFinding[] = [];

  for (const teamId of [...graph.teams.keys()].sort()) {
    const team = graph.teams.get(teamId)!;
    const doc = team.doc;

    if (doc.members.length > config.maxTeamSize) {
      findings.push({
        kind: "team-too-large",
        severity: "warning",
        teamId,
        detail: `${doc.members.length} members, above the limit of ${config.maxTeamSize} — past the point a team holds shared context`,
      });
    }

    const collaborations = doc.interactions.filter((interaction) => interaction.mode === "collaboration");

    if (collaborations.length > config.maxCollaborations) {
      findings.push({
        kind: "collaboration-overload",
        severity: "warning",
        teamId,
        detail: `${collaborations.length} concurrent collaborations, above the limit of ${config.maxCollaborations}`,
      });
    }

    for (const interaction of collaborations) {
      const end = expectedEnd(interaction);
      if (!end) {
        findings.push({
          kind: "collaboration-untimed",
          severity: "warning",
          teamId,
          subject: interaction.teamName,
          // The distinction the book draws: a collaboration is a temporary, deliberate expense.
          // One with no end date isn't a collaboration, it's two teams that have merged without
          // saying so.
          detail: `collaboration with ${interaction.teamName} declares no expectedDuration, so nothing says when it should end`,
        });
        continue;
      }
      if (end < now) {
        findings.push({
          kind: "collaboration-overrun",
          severity: "warning",
          teamId,
          subject: interaction.teamName,
          detail: `collaboration with ${interaction.teamName} was due to end ${formatDate(end)} and is still declared`,
        });
      }
    }

    // Platform teams exist to be consumed. One that depends on a stream-aligned team has inverted
    // the flow it was created to enable: the consumer now waits on the platform, which is waiting
    // on the consumer.
    if (doc.info.type === "platform") {
      for (const edge of graph.edges) {
        if (edge.kind !== "dependency" || edge.from !== teamId) continue;
        const target = graph.teams.get(edge.to);
        if (target?.doc.info.type !== "stream-aligned") continue;
        findings.push({
          kind: "platform-depends-on-stream",
          severity: "warning",
          teamId,
          subject: edge.to,
          detail: `platform team depends on stream-aligned team '${edge.to}', inverting the flow it exists to enable`,
        });
      }
    }

    for (const dependency of doc.dependencies) {
      if (dependency.type !== "Blocking") continue;
      findings.push({
        kind: "blocking-dependency",
        severity: "warning",
        teamId,
        subject: dependency.teamName,
        detail: `declares a Blocking dependency on ${dependency.teamName}`,
      });
    }
  }

  // Applied at the end rather than at each push, so every check above stays a plain statement of
  // what it found and only one place decides how loudly to say it.
  const graded: TopologyFinding[] = [];
  for (const finding of findings) {
    const override = config.severity[finding.kind];
    if (override === "off") continue;
    graded.push(override === undefined ? finding : { ...finding, severity: override });
  }

  return { findings: graded, teams: graph.teams.size };
}

/** Whether a report should fail a build. Nothing here blocks unless an org configured it to. */
export function hasBlockingTopologyFindings(report: TopologyReport): boolean {
  return report.findings.some((finding) => finding.severity === "blocking");
}

const MARK: Record<TopologyKind, string> = {
  "collaboration-overrun": "!",
  "collaboration-untimed": "~",
  "team-too-large": "?",
  "collaboration-overload": "?",
  "platform-depends-on-stream": "~",
  "blocking-dependency": "!",
};

export function formatTopology(report: TopologyReport): string {
  if (report.findings.length === 0) {
    return `No topology smells. ${report.teams} team(s) checked.`;
  }
  const lines = report.findings.map(
    (finding) => `${MARK[finding.kind]} ${finding.kind}: ${finding.teamId}: ${finding.detail}`,
  );
  const blocking = report.findings.filter((finding) => finding.severity === "blocking").length;
  lines.push("");
  lines.push(`${report.findings.length} finding(s), ${blocking} blocking; ${report.teams} team(s) checked.`);
  return lines.join("\n");
}

export function isTopologyKind(value: string): value is TopologyKind {
  return (
    [
      "collaboration-overrun",
      "collaboration-untimed",
      "team-too-large",
      "collaboration-overload",
      "platform-depends-on-stream",
      "blocking-dependency",
    ] as const
  ).includes(value as TopologyKind);
}
