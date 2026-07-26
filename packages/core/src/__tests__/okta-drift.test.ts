import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { formatOktaDrift, planOktaDrift, type DirectoryGroup } from "../apply/okta-drift";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");
const acme = () => buildOrgGraph({ seedUris: [CHECKOUT_SEED] });

/** A directory that agrees exactly with examples/acme-org. */
async function mirror(prefix = ""): Promise<DirectoryGroup[]> {
  const graph = await acme();
  return [...graph.teams.entries()].map(([teamId, team]) => ({
    name: `${prefix}${teamId}`,
    members: team.doc.members.map((m) => ({
      email: m.contact!,
      displayName: m.name,
      status: "ACTIVE",
    })),
  }));
}

describe("planOktaDrift", () => {
  it("finds nothing when the directory and the spec agree", async () => {
    const report = planOktaDrift(await acme(), await mirror());
    expect(report.findings).toEqual([]);
    expect(report.matched).toBeGreaterThan(0);
  });

  it("blocks on a deactivated account still listed as a member", async () => {
    const groups = await mirror();
    const checkout = groups.find((g) => g.name === "stream-checkout")!;
    checkout.members[0]!.status = "DEPROVISIONED";

    const report = planOktaDrift(await acme(), groups);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({ kind: "deactivated", severity: "blocking", teamId: "stream-checkout" });
    expect(report.findings[0]!.detail).toContain("is DEPROVISIONED in the directory but still listed");
  });

  it("reports someone in the group that no member declares", async () => {
    const groups = await mirror();
    groups
      .find((g) => g.name === "stream-checkout")!
      .members.push({ email: "new.joiner@acme.example", displayName: "New Joiner", status: "ACTIVE" });

    const report = planOktaDrift(await acme(), groups);
    expect(report.findings).toEqual([
      {
        kind: "joined",
        severity: "warning",
        teamId: "stream-checkout",
        subject: "new.joiner@acme.example",
        detail: "New Joiner is in stream-checkout's directory group but no member declares them",
      },
    ]);
  });

  it("does not call a deactivated stranger a joiner", async () => {
    const groups = await mirror();
    groups
      .find((g) => g.name === "stream-checkout")!
      .members.push({ email: "old.account@acme.example", status: "SUSPENDED" });

    expect(planOktaDrift(await acme(), groups).findings).toEqual([]);
  });

  it("reports a declared member the group has never contained", async () => {
    const groups = await mirror();
    const checkout = groups.find((g) => g.name === "stream-checkout")!;
    const gone = checkout.members.shift()!;

    const report = planOktaDrift(await acme(), groups);
    expect(report.findings[0]).toMatchObject({ kind: "left", severity: "warning", subject: gone.email });
  });

  it("matches addresses regardless of case or stray whitespace", async () => {
    const groups = await mirror();
    for (const group of groups) {
      for (const member of group.members) member.email = ` ${member.email.toUpperCase()} `;
    }
    expect(planOktaDrift(await acme(), groups).findings).toEqual([]);
  });

  it("strips a group-name prefix before matching team ids", async () => {
    const prefixed = await mirror("eng-");
    expect(planOktaDrift(await acme(), prefixed).findings.map((f) => f.kind)).toEqual([
      "no-group",
      "no-group",
      "no-group",
      "no-group",
    ]);
    expect(planOktaDrift(await acme(), prefixed, { groupPrefix: "eng-" }).findings).toEqual([]);
  });

  it("says so, rather than guessing, when a member has no contact address", async () => {
    const graph = await acme();
    const member = graph.teams.get("stream-checkout")!.doc.members[0]!;
    const groups = await mirror();
    groups.find((g) => g.name === "stream-checkout")!.members = groups
      .find((g) => g.name === "stream-checkout")!
      .members.filter((u) => u.email !== member.contact);
    delete member.contact;

    const report = planOktaDrift(graph, groups);
    expect(report.findings).toEqual([
      {
        kind: "unmatched",
        severity: "warning",
        teamId: "stream-checkout",
        subject: member.id,
        detail: `'${member.id}' has no contact address, so it can't be reconciled either way`,
      },
    ]);
  });

  it("reports a team with no directory group at all", async () => {
    const groups = (await mirror()).filter((g) => g.name !== "enabling-devex");
    const report = planOktaDrift(await acme(), groups);
    expect(report.findings).toEqual([
      {
        kind: "no-group",
        severity: "warning",
        teamId: "enabling-devex",
        detail: "no directory group matches 'enabling-devex'",
      },
    ]);
  });
});

describe("formatOktaDrift", () => {
  it("says so plainly when nothing has drifted", async () => {
    const out = formatOktaDrift(planOktaDrift(await acme(), await mirror()));
    expect(out).toMatch(/^No drift\. \d+ member\(s\) matched an active directory account\.$/);
  });

  it("marks each kind and counts the blocking ones apart", async () => {
    const groups = await mirror();
    const checkout = groups.find((g) => g.name === "stream-checkout")!;
    checkout.members[0]!.status = "DEPROVISIONED";
    checkout.members.push({ email: "new.joiner@acme.example", status: "ACTIVE" });

    const out = formatOktaDrift(planOktaDrift(await acme(), groups));
    expect(out).toContain("! deactivated:");
    expect(out).toContain("+ joined:");
    expect(out).toContain("2 finding(s), 1 blocking;");
  });
});
