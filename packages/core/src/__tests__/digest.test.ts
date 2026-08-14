import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildOrgDigest, digestHeadline, digestToHtml, digestToSlackMessage, formatDigestText } from "../digest/build";
import { planGaps } from "../gaps/plan";
import { checkPolicies } from "../policy/check";
import { checkTopology } from "../topology/heuristics";
import { snapshotOrg } from "../history/trends";
import type { OrgGraph } from "../model/org-graph";

const ACME_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");
const DRIFTWOOD_SEED = path.resolve(__dirname, "../../../../examples/driftwood-org/stream-insights/teamapi.yml");

let acme: OrgGraph;
let driftwood: OrgGraph;

beforeAll(async () => {
  [acme, driftwood] = await Promise.all([
    buildOrgGraph({ seedUris: [ACME_SEED] }),
    buildOrgGraph({ seedUris: [DRIFTWOOD_SEED] }),
  ]);
});

describe("buildOrgDigest", () => {
  it("merges gaps, policy and topology, blocking first", () => {
    const digest = buildOrgDigest(driftwood);
    expect(digest.items.length).toBeGreaterThan(0);
    expect(digest.blocking).toBeGreaterThan(0);

    const severities = digest.items.map((item) => item.severity);
    // A blocking finding under twenty warnings is a finding nobody acts on.
    expect(severities.indexOf("blocking")).toBeLessThan(severities.lastIndexOf("warning"));

    // Every finding from all three checks, not a sample of one of them: the whole reason for the
    // command is that getting this picture meant running three commands nobody ran.
    const expected =
      planGaps(driftwood).findings.length +
      checkPolicies(driftwood).findings.length +
      checkTopology(driftwood).findings.length;
    expect(digest.totalFindings).toBe(expected);
  });

  it("says how much it left out rather than silently truncating", () => {
    const digest = buildOrgDigest(driftwood, { limit: 2 });
    expect(digest.items).toHaveLength(2);
    expect(digest.totalFindings).toBeGreaterThan(2);
    expect(formatDigestText(digest)).toContain(`… and ${digest.totalFindings - 2} more`);
  });

  it("reports nothing to compare against on the first run", () => {
    // Refusing to produce a digest with no previous snapshot would make every installation's
    // first scheduled run fail.
    const digest = buildOrgDigest(acme);
    expect(digest.deltas).toEqual([]);
    expect(digest.teamsAdded).toEqual([]);
    expect(digest.teamsRemoved).toEqual([]);
  });

  it("reports only what moved", () => {
    // Eight unchanged numbers every week is a digest people filter into a folder.
    const previous = { ...snapshotOrg(acme), agents: 0, members: 99 };
    const digest = buildOrgDigest(acme, { previous });
    const labels = digest.deltas.map((delta) => delta.label);

    expect(labels).toContain("agents");
    expect(labels).toContain("people");
    expect(labels).not.toContain("teams");
  });

  it("names the teams that came and went", () => {
    const previous = { ...snapshotOrg(acme), teamIds: ["stream-checkout", "gone-team"] };
    const digest = buildOrgDigest(acme, { previous });
    expect(digest.teamsRemoved).toEqual(["gone-team"]);
    expect(digest.teamsAdded).toContain("platform-payments");
  });
});

describe("digestHeadline", () => {
  it("is one sentence somebody can read without opening anything", () => {
    expect(digestHeadline(buildOrgDigest(driftwood))).toMatch(/^\d+ teams — \d+ blocking/);
  });

  it("says so plainly when there is nothing to report", () => {
    const clean = { ...buildOrgDigest(acme), blocking: 0, warnings: 0 };
    expect(digestHeadline(clean)).toContain("nothing blocking");
  });
});

describe("digestToSlackMessage", () => {
  it("populates text alongside blocks", () => {
    // Blocks alone produce a notification saying "This content can't be displayed", which is what
    // most people see first and all screen readers see.
    const message = digestToSlackMessage(buildOrgDigest(driftwood), "Weekly");
    expect(typeof message.text).toBe("string");
    expect(String(message.text)).toContain("Weekly");
    expect(Array.isArray(message.blocks)).toBe(true);
  });

  it("chunks findings so no section exceeds Slack's limit", () => {
    // Slack rejects a section over 3000 characters outright, taking the whole message with it.
    const long = { ...buildOrgDigest(driftwood) };
    long.items = Array.from({ length: 200 }, (_, i) => ({
      severity: "warning" as const,
      teamId: `team-${i}`,
      kind: "x",
      detail: "d".repeat(80),
    }));
    long.totalFindings = 400;

    const blocks = digestToSlackMessage(long).blocks as Array<{ type: string; text?: { text: string } }>;
    for (const block of blocks) {
      if (block.text) expect(block.text.text.length).toBeLessThanOrEqual(3000);
    }
    expect(blocks.some((block) => block.type === "context")).toBe(true);
  });

  it("includes the deltas when there are any", () => {
    const digest = buildOrgDigest(acme, { previous: { ...snapshotOrg(acme), agents: 0 } });
    const blocks = JSON.stringify(digestToSlackMessage(digest));
    expect(blocks).toContain("Since last time");
  });
});

describe("digestToHtml", () => {
  it("escapes content that came out of a team document", () => {
    const digest = { ...buildOrgDigest(acme) };
    digest.items = [{ severity: "warning", teamId: "t", kind: "k", detail: '<script>alert("x")</script>' }];
    const html = digestToHtml(digest);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses inline styles, since mail clients strip everything else", () => {
    expect(digestToHtml(buildOrgDigest(driftwood))).toContain('style="');
  });

  it("says so when there is nothing to list", () => {
    const empty = { ...buildOrgDigest(acme), items: [], totalFindings: 0 };
    expect(digestToHtml(empty)).toContain("No findings.");
  });
});
