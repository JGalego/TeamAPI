import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  buildOrgDigest,
  buildOrgGraph,
  digestToHtml,
  digestToSlackMessage,
  formatDigestText,
  type OrgSnapshot,
} from "@jgalego/teamapi-core";
import { resolveOptions } from "../resolve-options";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export const DIGEST_FORMATS = ["text", "json", "html", "slack"] as const;
export type DigestFormat = (typeof DIGEST_FORMATS)[number];

export interface DigestOptions {
  format?: DigestFormat;
  /** Post the digest to a Slack (or Teams) incoming webhook. */
  webhook?: string;
  /** Write the rendered digest here instead of stdout. */
  out?: string;
  /**
   * A snapshot file to compare against, and to rewrite afterwards.
   *
   * A file rather than a database: the whole point is that this runs on a schedule in somebody
   * else's CI, and asking them to provision storage to receive a weekly summary is how a feature
   * goes unadopted. A workflow cache, an artifact, or a committed file all work.
   */
  state?: string;
  /** Findings to include before the list is capped. */
  limit?: number;
  /** Title on the message. Defaults to "Team API digest". */
  title?: string;
}

async function readState(file: string | undefined): Promise<OrgSnapshot | undefined> {
  if (!file) return undefined;
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as OrgSnapshot;
  } catch {
    // A missing or unreadable state file is the first run, not a failure. Refusing to produce a
    // digest because there is nothing to compare against would make the first scheduled run of
    // every installation fail.
    return undefined;
  }
}

async function postToWebhook(url: string, message: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webhook POST failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 500)}` : ""}`);
  }
}

/**
 * The org's state of play, on a cadence, pushed somewhere people already look.
 *
 * `gaps`, `policy` and `topology` have always been able to answer this. Getting the answer
 * required somebody to remember to run three commands, and the findings that matter most are also
 * the least urgent-feeling — a vacant role two teams report into, an agent nobody owns — so they
 * wait behind whatever is on fire. Indefinitely.
 *
 * The comparison against last run's snapshot is what makes it a digest rather than a report.
 * "Four blocking gaps" is a number people learn to scroll past; "two more than last week" is not.
 *
 * Exits 0 whatever it finds. A digest that failed the build on a warning would be turned off
 * within a fortnight, and then nobody would get the digest either.
 */
export async function runDigest(patterns: string[], options: DigestOptions = {}): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph(resolveOptions(seeds));
  warnUnresolved(graph);

  const digest = buildOrgDigest(graph, { previous: await readState(options.state), limit: options.limit });
  const title = options.title ?? "Team API digest";
  const format = options.format ?? (options.webhook ? "slack" : "text");

  const rendered =
    format === "json"
      ? JSON.stringify(digest, null, 2)
      : format === "html"
        ? digestToHtml(digest, title)
        : format === "slack"
          ? JSON.stringify(digestToSlackMessage(digest, title), null, 2)
          : formatDigestText(digest);

  if (options.webhook) {
    try {
      await postToWebhook(options.webhook, digestToSlackMessage(digest, title));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
    console.error(`Posted: ${digest.blocking} blocking, ${digest.warnings} warning(s).`);
  }

  if (options.out) {
    await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
    await fs.writeFile(options.out, `${rendered}\n`, "utf-8");
  } else if (!options.webhook) {
    // Only when there is nowhere else for it to go: a webhook run that also printed the payload
    // would fill a CI log with JSON nobody reads.
    console.log(rendered);
  }

  if (options.state) {
    // Written last, and only after everything else succeeded. Writing it first would mean a failed
    // delivery still consumed the comparison point, and the next run would report no change.
    await fs.mkdir(path.dirname(path.resolve(options.state)), { recursive: true });
    await fs.writeFile(options.state, JSON.stringify(digest.snapshot), "utf-8");
  }

  return 0;
}
