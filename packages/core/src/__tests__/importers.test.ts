import { describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { entityRefName, importBackstageCatalog, toSlug, type BackstageCatalogEntity } from "../import/backstage";
import { importDirectoryGroups, importSlackChannels } from "../import/directory";
import { CsvImportError, importCsvRoster, mapColumns, parseCsv } from "../import/csv";
import type { ImportedTeam } from "../import/github-org";

/** Every importer's output has to be a document `teamapi validate` accepts — an import that
 * produces something the schema rejects is worse than no importer, because the failure surfaces
 * after somebody has already committed it. */
function expectValid(imported: ImportedTeam[]): void {
  expect(imported.length).toBeGreaterThan(0);
  for (const { document } of imported) {
    const parsed = TeamApiDocumentSchema.safeParse(document);
    expect(
      parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    ).toEqual([]);
  }
}

describe("importBackstageCatalog", () => {
  const catalog: BackstageCatalogEntity[] = [
    {
      kind: "Group",
      metadata: { name: "payments", title: "Payments", description: "Money movement" },
      spec: { type: "team" },
    },
    { kind: "Group", metadata: { name: "infra" }, spec: { type: "platform" } },
    {
      kind: "User",
      metadata: { name: "aoife.byrne" },
      spec: {
        profile: { displayName: "Aoife Byrne", email: "aoife@example.com" },
        memberOf: ["group:default/payments"],
      },
    },
    {
      kind: "User",
      metadata: { name: "sam.okafor" },
      // A processed entity carries `relations` and often not `spec.memberOf`.
      relations: [{ type: "memberOf", targetRef: "group:default/infra" }],
    },
    {
      kind: "Component",
      metadata: { name: "ledger", annotations: { "backstage.io/source-location": "url:https://github.com/x/ledger/" } },
      spec: { owner: "group:default/payments" },
    },
    { kind: "API", metadata: { name: "ledger-api" }, spec: { owner: "payments" } },
    // Owned by a group that is not in the catalog: dropped rather than inventing a team for it.
    { kind: "Component", metadata: { name: "orphan" }, spec: { owner: "group:default/nowhere" } },
  ];

  it("produces one valid document per Group", () => {
    const imported = importBackstageCatalog(catalog);
    expect(imported.map((entry) => entry.teamId)).toEqual(["infra", "payments"]);
    expectValid(imported);
  });

  it("maps spec.type onto a Team Topologies type, defaulting the rest", () => {
    const [infra, payments] = importBackstageCatalog(catalog);
    expect((infra!.document.info as { type: string }).type).toBe("platform");
    expect((payments!.document.info as { type: string }).type).toBe("stream-aligned");
  });

  it("reads membership from spec.memberOf and from relations alike", () => {
    // A raw catalog-info.yaml and the entities the catalog API returns are different documents
    // that people reasonably expect to behave the same.
    const byId = new Map(importBackstageCatalog(catalog).map((entry) => [entry.teamId, entry.document]));
    expect((byId.get("payments")!.members as Array<{ name: string }>)[0]!.name).toBe("Aoife Byrne");
    expect((byId.get("infra")!.members as Array<{ id: string }>)[0]!.id).toBe("sam-okafor");
  });

  it("attaches components and APIs to their owning group, and drops the rest", () => {
    const payments = importBackstageCatalog(catalog).find((entry) => entry.teamId === "payments")!;
    const services = payments.document.services as Array<{ name: string; repository?: string }>;
    expect(services.map((service) => service.name)).toEqual(["ledger", "ledger-api"]);
    expect(services[0]!.repository).toBe("https://github.com/x/ledger");
    expect(JSON.stringify(importBackstageCatalog(catalog))).not.toContain("orphan");
  });

  it("returns nothing for a catalog with no groups", () => {
    expect(importBackstageCatalog([{ kind: "Component", metadata: { name: "x" } }])).toEqual([]);
  });

  it("resolves entity refs in all three spellings", () => {
    expect(entityRefName("group:default/payments")).toBe("payments");
    expect(entityRefName("group:payments")).toBe("payments");
    expect(entityRefName("payments")).toBe("payments");
  });

  it("slugs a name the schema would otherwise reject", () => {
    expect(toSlug("Stream Checkout")).toBe("stream-checkout");
    expect(toSlug("R&D / Platform")).toBe("r-d-platform");
    expect(toSlug("!!!")).toBe("team");
  });
});

describe("importDirectoryGroups", () => {
  const groups = [
    {
      name: "eng-payments",
      members: [
        { email: "aoife@example.com", displayName: "Aoife Byrne", status: "ACTIVE" },
        { email: "sam@example.com", displayName: "Sam Okafor", status: "ACTIVE" },
        { email: "gone@example.com", displayName: "Departed Person", status: "DEPROVISIONED" },
      ],
    },
    { name: "eng-solo", members: [{ email: "only@example.com", status: "ACTIVE" }] },
  ];

  it("strips the prefix so team ids match what okta-drift matches on", () => {
    const imported = importDirectoryGroups(groups, { groupPrefix: "eng-" });
    expect(imported.map((entry) => entry.teamId)).toEqual(["payments"]);
    expectValid(imported);
  });

  it("drops deactivated accounts rather than importing them", () => {
    // okta-drift reports these as findings on an existing org because a name still listed for
    // someone who left is the dangerous case. On a fresh import there is nothing to report
    // against, and importing them would create exactly the drift the tool exists to catch.
    const members = importDirectoryGroups(groups, { groupPrefix: "eng-" })[0]!.document.members as Array<{
      name: string;
    }>;
    expect(members.map((member) => member.name)).toEqual(["Aoife Byrne", "Sam Okafor"]);
  });

  it("skips groups too small to be a team", () => {
    // Directories are full of one-person groups that are access-control artefacts.
    expect(importDirectoryGroups(groups).map((entry) => entry.teamId)).toEqual(["eng-payments"]);
    expect(importDirectoryGroups(groups, { minMembers: 1 })).toHaveLength(2);
  });

  it("falls back to the address when the directory has no display name", () => {
    const [team] = importDirectoryGroups(groups, { minMembers: 1 });
    expect(team).toBeDefined();
    const solo = importDirectoryGroups(groups, { minMembers: 1 }).find((entry) => entry.teamId === "eng-solo")!;
    expect((solo.document.members as Array<{ name: string }>)[0]!.name).toBe("only@example.com");
  });
});

describe("importSlackChannels", () => {
  const channels = [
    { id: "C1", name: "team-checkout", topic: "Cart and checkout flow" },
    { id: "C2", name: "team-payments" },
    { id: "C3", name: "random" },
  ];

  it("produces a valid skeleton with the channel already declared", () => {
    const imported = importSlackChannels(channels, { channelPrefix: "team-", channelPattern: /^team-/ });
    expect(imported.map((entry) => entry.teamId)).toEqual(["checkout", "payments"]);
    expectValid(imported);
    expect(imported[0]!.document.channels).toEqual([{ type: "slack", name: "team-checkout" }]);
  });

  it("uses the topic as the focus, and title-cases the name", () => {
    const [checkout] = importSlackChannels(channels, { channelPrefix: "team-", channelPattern: /^team-/ });
    expect(checkout!.document.info).toEqual({
      name: "Checkout",
      focus: "Cart and checkout flow",
      type: "stream-aligned",
    });
  });

  it("imports no members, even though the API could list them", () => {
    // A channel's membership is not a team: it includes everybody who ever wanted visibility, and
    // importing it would produce members[] that are wrong in a way that looks authoritative.
    for (const { document } of importSlackChannels(channels)) expect(document.members).toEqual([]);
  });

  it("filters to the channels that are actually teams", () => {
    expect(importSlackChannels(channels).map((entry) => entry.teamId)).toContain("random");
    expect(importSlackChannels(channels, { channelPattern: /^team-/ }).map((entry) => entry.teamId)).not.toContain(
      "random",
    );
  });
});

describe("parseCsv", () => {
  it("handles quoted fields, embedded commas, newlines and doubled quotes", () => {
    // Splitting on commas would corrupt every row with a title like "Engineer, Payments" — which
    // is most HR exports.
    expect(parseCsv('a,"b,c",d\n1,"two\nlines","say ""hi"""')).toEqual([
      ["a", "b,c", "d"],
      ["1", "two\nlines", 'say "hi"'],
    ]);
  });

  it("tolerates CRLF and drops blank rows", () => {
    expect(parseCsv("a,b\r\n1,2\r\n\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("mapColumns", () => {
  it("accepts the spellings different HR systems use for the same column", () => {
    expect(mapColumns(["Work Email", "Full Name", "Department", "Job Title"])).toEqual({
      email: 0,
      name: 1,
      team: 2,
      role: 3,
    });
  });
});

describe("importCsvRoster", () => {
  const roster = [
    "Full Name,Work Email,Department,Job Title,GitHub",
    "Aoife Byrne,aoife@example.com,Stream Checkout,Tech Lead,aoife",
    "Sam Okafor,sam@example.com,Stream Checkout,Engineer,sam-o",
    "Priya Raman,priya@example.com,Stream Checkout,Engineer,",
    'Dan Ito,dan@example.com,Platform Payments,"Engineer, Payments",dan',
  ].join("\n");

  it("produces valid documents, one per team", () => {
    const imported = importCsvRoster(roster);
    expect(imported.map((entry) => entry.teamId)).toEqual(["platform-payments", "stream-checkout"]);
    expectValid(imported);
  });

  it("creates one role per distinct title, shared by everybody holding it", () => {
    // A role-per-person model gets job-sharing wrong; this is the distinction the schema exists
    // around, and the job-title column is the one place an org writes it down.
    const checkout = importCsvRoster(roster).find((entry) => entry.teamId === "stream-checkout")!;
    const roles = checkout.document.roles as Array<{ id: string; name: string }>;
    expect(roles.map((role) => role.id)).toEqual(["engineer", "tech-lead"]);

    const members = checkout.document.members as Array<{ id: string; roleIds: string[] }>;
    expect(members.filter((member) => member.roleIds.includes("engineer"))).toHaveLength(2);
  });

  it("keys members by email local-part, so two people with one name do not collide", () => {
    const collision = ["Name,Email,Team", "Alex Chen,alex.chen@x.com,Eng", "Alex Chen,alex.chen2@x.com,Eng"].join("\n");
    const members = importCsvRoster(collision)[0]!.document.members as Array<{ id: string }>;
    expect(members.map((member) => member.id)).toEqual(["alex-chen", "alex-chen2"]);
  });

  it("keeps a title containing a comma intact", () => {
    const payments = importCsvRoster(roster).find((entry) => entry.teamId === "platform-payments")!;
    expect((payments.document.roles as Array<{ name: string }>)[0]!.name).toBe("Engineer, Payments");
  });

  it("carries the GitHub column through, and omits it when blank", () => {
    const members = importCsvRoster(roster).find((entry) => entry.teamId === "stream-checkout")!.document
      .members as Array<{ githubUsername?: string }>;
    expect(members.some((member) => member.githubUsername === "aoife")).toBe(true);
    expect(members.some((member) => member.githubUsername === undefined)).toBe(true);
  });

  it("names the columns it looked for when it cannot find one", () => {
    expect(() => importCsvRoster("Name,Email\nA,a@x.com")).toThrow(CsvImportError);
    expect(() => importCsvRoster("Name,Email\nA,a@x.com")).toThrow(/No team column found.*department/is);
    expect(() => importCsvRoster("Team\nEng")).toThrow(/No person column/);
    expect(() => importCsvRoster("Name,Team")).toThrow(/no data rows/i);
  });
});
