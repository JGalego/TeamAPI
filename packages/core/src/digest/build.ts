import type { OrgGraph } from "../model/org-graph";
import { planGaps } from "../gaps/plan";
import { checkPolicies } from "../policy/check";
import { checkTopology } from "../topology/heuristics";
import { snapshotOrg, type OrgSnapshot } from "../history/trends";
import {
  normalizeGapFinding,
  normalizePolicyFinding,
  normalizeTopologyFinding,
  sortFindings,
} from "../report/findings";

export interface DigestItem {
  severity: "blocking" | "warning" | "info";
  teamId: string;
  kind: string;
  detail: string;
}

export interface DigestDelta {
  label: string;
  before: number;
  after: number;
}

export interface OrgDigest {
  /** ISO timestamp the digest was built. */
  generatedAt: string;
  snapshot: OrgSnapshot;
  /** Blocking findings first, then warnings, capped — see `buildOrgDigest`. */
  items: DigestItem[];
  /** Total findings before the cap, so a truncated digest says how much it left out. */
  totalFindings: number;
  blocking: number;
  warnings: number;
  /** What moved since the comparison snapshot. Empty when none was supplied. */
  deltas: DigestDelta[];
  /** Teams that were not in the previous snapshot, and teams that no longer are. */
  teamsAdded: string[];
  teamsRemoved: string[];
}

export interface DigestOptions {
  /** A previous snapshot to compare against — the same shape `teamapi history` produces, so a
   * scheduled digest can carry its own state forward without a database. */
  previous?: OrgSnapshot;
  /** Findings to include. Defaults to 25. */
  limit?: number;
}

const DEFAULT_LIMIT = 25;
/**
 * The org's weekly state of play: what is unowned, what is overloaded, and what moved.
 *
 * Everything in here has been computable since `gaps`, `policy` and `topology` landed, and was
 * therefore available to anybody who remembered to run three commands. Nobody remembers. The
 * findings that matter most are also the least urgent-feeling — a vacant role two teams report
 * into, an agent nobody owns, supervision load nobody scored — so they wait behind whatever is on
 * fire, indefinitely.
 *
 * The comparison against a previous snapshot is what turns a report into a digest. "Four blocking
 * gaps" is a number somebody has already learned to scroll past; "four blocking gaps, two more
 * than last week" is not.
 *
 * Pure: no I/O, no network. `previous` is passed in, so a caller can keep it in a file, an issue
 * body, or a workflow artifact rather than this needing a database.
 */
export function buildOrgDigest(graph: OrgGraph, options: DigestOptions = {}): OrgDigest {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const snapshot = snapshotOrg(graph);

  const all: DigestItem[] = sortFindings([
    ...planGaps(graph).findings.map(normalizeGapFinding),
    ...checkPolicies(graph).findings.map(normalizePolicyFinding),
    ...checkTopology(graph).findings.map(normalizeTopologyFinding),
  ]).map((finding) => ({
    severity: finding.severity,
    teamId: finding.teamId ?? finding.targetId,
    kind: finding.source === "policy" ? `policy/${finding.metadata?.ruleKey ?? finding.ruleId}` : finding.ruleId,
    detail: finding.source === "policy" ? `${finding.summary}: ${finding.detail}` : finding.detail,
  }));

  const previous = options.previous;
  const deltas: DigestDelta[] = [];
  if (previous) {
    const track: Array<[string, keyof OrgSnapshot]> = [
      ["blocking gaps", "blockingGaps"],
      ["teams", "teams"],
      ["people", "members"],
      ["vacant roles", "vacantRoles"],
      ["overloaded teams", "overloadedTeams"],
      ["agents", "agents"],
      ["mean supervision", "avgSupervision"],
      ["unscored supervision", "unscoredSupervision"],
    ];
    for (const [label, key] of track) {
      const before = previous[key] as number;
      const after = snapshot[key] as number;
      // Only what moved. A digest listing eight unchanged numbers every week is a digest people
      // filter into a folder.
      if (before !== after) deltas.push({ label, before, after });
    }
  }

  const before = new Set(previous?.teamIds ?? []);
  const after = new Set(snapshot.teamIds);

  return {
    generatedAt: new Date().toISOString(),
    snapshot,
    items: all.slice(0, limit),
    totalFindings: all.length,
    blocking: all.filter((item) => item.severity === "blocking").length,
    warnings: all.filter((item) => item.severity === "warning").length,
    deltas,
    teamsAdded: previous ? snapshot.teamIds.filter((id) => !before.has(id)) : [],
    teamsRemoved: previous ? previous.teamIds.filter((id) => !after.has(id)) : [],
  };
}

function deltaLine(delta: DigestDelta): string {
  const direction = delta.after > delta.before ? "+" : "";
  return `${delta.label}: ${delta.before} → ${delta.after} (${direction}${Number((delta.after - delta.before).toFixed(2))})`;
}

/** The headline: one sentence somebody can read without opening anything. */
export function digestHeadline(digest: OrgDigest): string {
  if (digest.blocking === 0 && digest.warnings === 0) {
    return `${digest.snapshot.teams} teams, nothing blocking, nothing to flag.`;
  }
  const parts = [`${digest.blocking} blocking`];
  if (digest.warnings > 0) parts.push(`${digest.warnings} warning${digest.warnings === 1 ? "" : "s"}`);
  return `${digest.snapshot.teams} teams — ${parts.join(", ")}.`;
}

export function formatDigestText(digest: OrgDigest): string {
  const lines: string[] = [digestHeadline(digest), ""];

  if (digest.deltas.length > 0) {
    lines.push("Since last time:");
    for (const delta of digest.deltas) lines.push(`  ${deltaLine(delta)}`);
    if (digest.teamsAdded.length > 0) lines.push(`  teams added: ${digest.teamsAdded.join(", ")}`);
    if (digest.teamsRemoved.length > 0) lines.push(`  teams removed: ${digest.teamsRemoved.join(", ")}`);
    lines.push("");
  }

  if (digest.items.length === 0) {
    lines.push("No findings.");
  } else {
    for (const item of digest.items) {
      lines.push(`  ${item.severity === "blocking" ? "!" : "-"} ${item.teamId} [${item.kind}] ${item.detail}`);
    }
    if (digest.totalFindings > digest.items.length) {
      // Named rather than silently truncated: a capped list that does not say it was capped reads
      // as the complete picture.
      lines.push(`  … and ${digest.totalFindings - digest.items.length} more`);
    }
  }

  return lines.join("\n");
}

/**
 * Slack Block Kit, which is also what Teams and most other webhook receivers accept as `text`.
 *
 * `text` is populated alongside `blocks` because that is what a notification preview and every
 * accessibility surface reads; blocks alone produce a notification saying "This content can't be
 * displayed".
 */
export function digestToSlackMessage(digest: OrgDigest, title = "Team API digest"): Record<string, unknown> {
  const blocks: Array<Record<string, unknown>> = [
    { type: "header", text: { type: "plain_text", text: title } },
    { type: "section", text: { type: "mrkdwn", text: `*${digestHeadline(digest)}*` } },
  ];

  if (digest.deltas.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Since last time*\n${digest.deltas.map((d) => `• ${deltaLine(d)}`).join("\n")}` },
    });
  }

  if (digest.items.length > 0) {
    // Slack rejects a section over 3000 characters outright, taking the whole message with it, so
    // the findings are chunked rather than trusted to fit.
    const rendered = digest.items.map(
      (item) => `${item.severity === "blocking" ? "🔴" : "🟡"} *${item.teamId}* ${item.detail}`,
    );
    let chunk: string[] = [];
    let length = 0;
    for (const line of rendered) {
      if (length + line.length > 2800 && chunk.length > 0) {
        blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk.join("\n") } });
        chunk = [];
        length = 0;
      }
      chunk.push(line);
      length += line.length + 1;
    }
    if (chunk.length > 0) blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk.join("\n") } });
    if (digest.totalFindings > digest.items.length) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `… and ${digest.totalFindings - digest.items.length} more` }],
      });
    }
  }

  return { text: `${title}: ${digestHeadline(digest)}`, blocks };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A self-contained HTML body for email. Inline styles, because every mail client strips a
 * stylesheet and half of them strip a `<style>` block too. */
export function digestToHtml(digest: OrgDigest, title = "Team API digest"): string {
  const rows = digest.items
    .map(
      (item) =>
        `<tr><td style="padding:4px 8px;color:${item.severity === "blocking" ? "#b91c1c" : "#b45309"}">${item.severity}</td>` +
        `<td style="padding:4px 8px"><code>${escapeHtml(item.teamId)}</code></td>` +
        `<td style="padding:4px 8px">${escapeHtml(item.detail)}</td></tr>`,
    )
    .join("\n");

  const deltas = digest.deltas.map((delta) => `<li>${escapeHtml(deltaLine(delta))}</li>`).join("\n");

  return [
    `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#1f2933">`,
    `<h2 style="margin:0 0 4px">${escapeHtml(title)}</h2>`,
    `<p style="margin:0 0 12px">${escapeHtml(digestHeadline(digest))}</p>`,
    deltas ? `<h3 style="margin:12px 0 4px;font-size:14px">Since last time</h3><ul>${deltas}</ul>` : "",
    rows ? `<table style="border-collapse:collapse;width:100%">${rows}</table>` : "<p>No findings.</p>",
    digest.totalFindings > digest.items.length
      ? `<p style="color:#616e7c">… and ${digest.totalFindings - digest.items.length} more</p>`
      : "",
    `</div>`,
  ]
    .filter(Boolean)
    .join("\n");
}
