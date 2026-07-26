import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildCodeowners, parseRepoSlug } from "../generators/codeowners";

const ACME_ROOT = path.resolve(__dirname, "../../../../examples/acme-org");
const CHECKOUT_SEED = path.join(ACME_ROOT, "stream-checkout/teamapi.yml");

const checkout = (files: { repo: string }[]) =>
  files.find((f) => f.repo === "acme-example/checkout-api") as never as
    { content: string; teamId: string; services: string[] };

describe("parseRepoSlug", () => {
  it("reduces the URL forms a repository field actually carries to owner/repo", () => {
    expect(parseRepoSlug("https://github.com/acme/checkout-api")).toBe("acme/checkout-api");
    expect(parseRepoSlug("https://github.com/acme/checkout-api.git")).toBe("acme/checkout-api");
    expect(parseRepoSlug("https://github.com/acme/checkout-api/")).toBe("acme/checkout-api");
    expect(parseRepoSlug("git@github.com:acme/checkout-api.git")).toBe("acme/checkout-api");
    expect(parseRepoSlug("https://gitlab.com/acme/checkout-api")).toBe("acme/checkout-api");
  });

  it("returns null when there is no owner/repo to address", () => {
    expect(parseRepoSlug("https://github.com/acme")).toBeNull();
    expect(parseRepoSlug("not a url")).toBeNull();
  });
});

describe("codeowners generator — examples/acme-org", () => {
  // the seed resolves its $refs, so the graph is the whole org: four teams, four repos
  it("writes one file per repository, at the path the repo expects", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { files } = buildCodeowners(graph, { org: "acme-example" });

    expect(files.map((f) => f.path)).toEqual([
      "acme-example/checkout-api/CODEOWNERS",
      "acme-example/ledger/CODEOWNERS",
      "acme-example/onboarding-api/CODEOWNERS",
      "acme-example/payments-api/CODEOWNERS",
    ]);
    expect(checkout(files)).toMatchObject({ teamId: "stream-checkout", services: ["checkout-api"] });
  });

  it("uses the same @org/team-id slug that apply provisions", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { files } = buildCodeowners(graph, { org: "acme-example" });
    expect(checkout(files).content).toContain("* @acme-example/stream-checkout");
  });

  it("falls back to member handles when no org is given", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { files } = buildCodeowners(graph);
    const rule = checkout(files).content.split("\n").find((l) => l.startsWith("* "))!;
    // every handle on the rule line is a real githubUsername from the team document
    const declared = new Set(graph.teams.get("stream-checkout")!.doc.members.map((m) => m.githubUsername));
    for (const owner of rule.slice(2).split(" ")) {
      expect(declared.has(owner.replace(/^@/, ""))).toBe(true);
    }
  });

  it("names the team and the services that earned it the ownership", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const { files } = buildCodeowners(graph, { org: "acme-example" });
    expect(checkout(files).content).toContain("# Owner: Stream Checkout (stream-checkout)");
    expect(checkout(files).content).toContain("# Because it owns: checkout-api");
  });

  it("groups several services in one repository into a single file", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    const team = graph.teams.get("stream-checkout")!;
    team.doc.services.push({ name: "checkout-worker", repository: "https://github.com/acme-example/checkout-api" });

    const { files } = buildCodeowners(graph, { org: "acme-example" });
    expect(files.filter((f) => f.repo === "acme-example/checkout-api")).toHaveLength(1);
    expect(checkout(files).services).toEqual(["checkout-api", "checkout-worker"]);
  });

  it("reports a repository claimed by two teams instead of picking one", async () => {
    const graph = await buildOrgGraph({
      seedUris: [CHECKOUT_SEED, path.join(ACME_ROOT, "platform-payments/teamapi.yml")],
    });
    graph.teams.get("platform-payments")!.doc.services.push({
      name: "checkout-shim",
      repository: "https://github.com/acme-example/checkout-api",
    });

    const { files, conflicts } = buildCodeowners(graph, { org: "acme-example" });
    expect(conflicts).toEqual([
      { repo: "acme-example/checkout-api", teamIds: ["platform-payments", "stream-checkout"] },
    ]);
    expect(files.some((f) => f.repo === "acme-example/checkout-api")).toBe(false);
  });

  it("skips a service with no repository, and says why", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    graph.teams.get("stream-checkout")!.doc.services.push({ name: "checkout-ui" });

    const { skipped } = buildCodeowners(graph, { org: "acme-example" });
    expect(skipped).toContainEqual({
      teamId: "stream-checkout",
      service: "checkout-ui",
      reason: "no repository declared",
    });
  });

  it("skips a repo it cannot attribute to anyone", async () => {
    const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
    for (const member of graph.teams.get("stream-checkout")!.doc.members) delete member.githubUsername;

    const { files, skipped } = buildCodeowners(graph);
    expect(files.some((f) => f.teamId === "stream-checkout")).toBe(false);
    expect(skipped).toContainEqual({
      teamId: "stream-checkout",
      service: "checkout-api",
      reason: "no --org and no member has a githubUsername",
    });
  });
});
