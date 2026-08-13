import { z } from "zod";
import type { GapFinding, GapKind, GapsReport } from "./plan";

/**
 * Per-org configuration for the gaps check: severity overrides and expiring waivers.
 *
 * The problem this solves is adoption. `teamapi gaps` run against an org that has been operating
 * for years reports its entire accumulated history at once, and a check that goes red on the day
 * it is switched on — with dozens of findings, none of them today's fault — gets switched back
 * off. There has to be a way to say "we know, not now" that is narrower than disabling the check.
 *
 * Two mechanisms, deliberately different:
 *
 * - **severity** re-grades a whole *kind* of finding, permanently. It is the org saying this class
 *   of thing is or isn't a gate for us. `off` exists because some findings genuinely don't apply
 *   to some orgs — a company that treats every published event as a public contract will never
 *   care about `unconsumed-event`.
 * - **waivers** exempt one specific finding, temporarily, with a reason. They are for "yes, that
 *   one, we've decided, here's why".
 *
 * Waivers expire because an exemption that doesn't is just a deletion with extra steps, and the
 * whole value of writing the reason down is that somebody reads it again later. An expired waiver
 * doesn't silently start failing the build, either — it is reported as its own finding, so the
 * team learns the exemption lapsed rather than discovering it through a red build.
 */

export const GAP_SEVERITY_OVERRIDES = ["warning", "blocking", "off"] as const;
export type GapSeverityOverride = (typeof GAP_SEVERITY_OVERRIDES)[number];

export const GapWaiverSchema = z
  .object({
    kind: z.string().min(1),
    /** Narrows the waiver to one team. Omitted, it applies to every team — which is almost always
     * too broad, and is why `reason` is mandatory. */
    teamId: z.string().min(1).optional(),
    /** Narrows to one subject: the event, role, agent or team id the finding names. */
    subject: z.string().min(1).optional(),
    /** Required. A waiver whose reason is missing is indistinguishable later from one added to
     * make a build pass, which is the thing this is meant not to become. */
    reason: z.string().min(1),
    /** ISO date (`YYYY-MM-DD`) after which this waiver stops applying. */
    expires: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "expires must be an ISO date (YYYY-MM-DD)")
      .optional(),
  })
  .strict();
export type GapWaiver = z.infer<typeof GapWaiverSchema>;

export const GapRulesConfigSchema = z
  .object({
    severity: z.record(z.enum(GAP_SEVERITY_OVERRIDES)).default({}),
    waivers: z.array(GapWaiverSchema).default([]),
  })
  .strict();
export type GapRulesConfig = z.infer<typeof GapRulesConfigSchema>;

export interface WaivedGapFinding {
  finding: GapFinding;
  waiver: GapWaiver;
}

export interface AppliedGapsReport extends GapsReport {
  /** Findings a live waiver excused. Kept rather than dropped, so `--format json` can still show
   * what the org has chosen to live with — an exemption nobody can see is not a decision, it's a
   * silence. */
  waived: WaivedGapFinding[];
  /** Waivers past their `expires` date that matched a finding. The finding is reported as normal
   * and this says why it came back. */
  expired: { waiver: GapWaiver; matched: number }[];
  /** Waivers that matched nothing: either the gap was fixed, or the waiver never described a real
   * finding. Both are worth deleting, and neither is visible without saying so. */
  unused: GapWaiver[];
}

function matches(finding: GapFinding, waiver: GapWaiver): boolean {
  if (finding.kind !== waiver.kind) return false;
  if (waiver.teamId !== undefined && finding.teamId !== waiver.teamId) return false;
  if (waiver.subject !== undefined && finding.subject !== waiver.subject) return false;
  return true;
}

/** Compared date-only, in UTC, so a waiver expires on the same calendar day everywhere rather
 * than lapsing eight hours early for whoever happens to run CI in Auckland. */
function isExpired(waiver: GapWaiver, now: Date): boolean {
  if (!waiver.expires) return false;
  return now.toISOString().slice(0, 10) > waiver.expires;
}

/**
 * Applies severity overrides and waivers to a raw `GapsReport`.
 *
 * Order matters: severity is applied first, so a waiver still matches a finding whose severity the
 * org re-graded, and `off` removes a finding before any waiver could claim to have excused it —
 * which keeps a disabled kind from making its waivers look used.
 */
export function applyGapRules(report: GapsReport, config: GapRulesConfig, now: Date = new Date()): AppliedGapsReport {
  const findings: GapFinding[] = [];
  const waived: WaivedGapFinding[] = [];
  const usage = new Map<GapWaiver, number>();
  const expiredUsage = new Map<GapWaiver, number>();

  const live = config.waivers.filter((waiver) => !isExpired(waiver, now));
  const expired = config.waivers.filter((waiver) => isExpired(waiver, now));

  for (const original of report.findings) {
    const override = config.severity[original.kind];
    if (override === "off") continue;

    // `off` was handled above, so what remains narrows to the two real severities.
    const finding: GapFinding = override === undefined ? original : { ...original, severity: override };

    const waiver = live.find((candidate) => matches(finding, candidate));
    if (waiver) {
      usage.set(waiver, (usage.get(waiver) ?? 0) + 1);
      waived.push({ finding, waiver });
      continue;
    }

    // Not waived — but if an *expired* waiver would have covered it, say so alongside the finding
    // rather than letting the build just turn red for no visible reason.
    const lapsed = expired.find((candidate) => matches(finding, candidate));
    if (lapsed) expiredUsage.set(lapsed, (expiredUsage.get(lapsed) ?? 0) + 1);

    findings.push(finding);
  }

  return {
    ...report,
    findings,
    waived,
    expired: [...expiredUsage.entries()].map(([waiver, matched]) => ({ waiver, matched })),
    unused: [...live, ...expired].filter((waiver) => !usage.has(waiver) && !expiredUsage.has(waiver)),
  };
}

/** Whether an applied report should fail a build: blocking findings only, never waived ones. */
export function hasBlockingGaps(report: AppliedGapsReport): boolean {
  return report.findings.some((finding) => finding.severity === "blocking");
}

/** The extra lines an applied report adds beneath `formatGaps`'s output. Separate from
 * `formatGaps` so the plain report keeps rendering identically for callers with no config. */
export function formatGapRuleEffects(report: AppliedGapsReport): string {
  const lines: string[] = [];

  for (const { finding, waiver } of report.waived) {
    const until = waiver.expires ? `, until ${waiver.expires}` : "";
    lines.push(`= waived ${finding.kind}: ${finding.detail} (${waiver.reason}${until})`);
  }
  for (const { waiver, matched } of report.expired) {
    lines.push(
      `! expired waiver for ${waiver.kind}${waiver.subject ? ` '${waiver.subject}'` : ""}: expired ${waiver.expires}, ` +
        `${matched} finding(s) reported again`,
    );
  }
  for (const waiver of report.unused) {
    lines.push(
      `- unused waiver for ${waiver.kind}${waiver.subject ? ` '${waiver.subject}'` : ""}: matched nothing, delete it`,
    );
  }

  return lines.join("\n");
}

/** Every gap kind an override or waiver may name, for validating a config against reality. */
export function isGapKind(value: string): value is GapKind {
  return (
    [
      "dangling-owner",
      "orphan-subscription",
      "unconsumed-event",
      "vacant-load-bearing",
      "unacknowledged",
      "unaccountable-agent",
      "unscored-supervision",
    ] as const
  ).includes(value as GapKind);
}
