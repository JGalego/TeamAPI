import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseDocument } from "yaml";
import { buildOrgGraph } from "../resolve/graph-builder";
import { buildTeamProposal, proposalBranchName, proposalPullRequest, ProposalError } from "../propose/patch";
import { openTeamProposal, repositoryPath } from "../propose/github-pr";
import { GithubClient } from "../github/client";
import type { ResolvedTeam } from "../model/org-graph";

const CHECKOUT_SEED = path.resolve(__dirname, "../../../../examples/acme-org/stream-checkout/teamapi.yml");

let team: ResolvedTeam;
let original: string;

beforeAll(async () => {
  const graph = await buildOrgGraph({ seedUris: [CHECKOUT_SEED] });
  team = graph.teams.get("stream-checkout")!;
  original = fs.readFileSync(CHECKOUT_SEED, "utf-8");
});

const asObject = (content: string) => parseDocument(content).toJS() as Record<string, never>;

describe("buildTeamProposal", () => {
  it("changes only what the patch names", () => {
    const proposal = buildTeamProposal(team, { info: { focus: "Cart, checkout, and refunds" } }, original);
    const after = asObject(proposal.content);
    const before = asObject(original);

    expect((after.info as unknown as { focus: string }).focus).toBe("Cart, checkout, and refunds");
    // Everything else byte-for-byte identical once the one changed field is normalised away.
    expect({ ...after, info: undefined }).toEqual({ ...before, info: undefined });
    expect((after.info as unknown as { type: string }).type).toBe((before.info as unknown as { type: string }).type);
  });

  it("keeps the file's comments", () => {
    // These documents carry the reasons things are the way they are. A write path that deleted
    // them would make the format worse for having a UI.
    const commentsBefore = original.split("\n").filter((line) => line.trim().startsWith("#")).length;
    const proposal = buildTeamProposal(team, { info: { focus: "Something else entirely" } }, original);
    expect(proposal.content.split("\n").filter((line) => line.trim().startsWith("#")).length).toBe(commentsBefore);
  });

  it("summarises each change in terms a reviewer can read", () => {
    const proposal = buildTeamProposal(
      team,
      { cognitiveLoad: { intrinsic: 6, extraneous: 4, germane: 4, supervision: 3 } },
      original,
    );
    expect(proposal.summary.some((line) => line.startsWith("cognitiveLoad.extraneous:"))).toBe(true);
    expect(proposal.summary.some((line) => line.includes("→"))).toBe(true);
  });

  it("replaces a cognitive load assessment wholesale rather than merging it", () => {
    // The four scores are one assessment made at one time; merging a new intrinsic into last
    // quarter's extraneous produces a total nobody assessed.
    const proposal = buildTeamProposal(team, { cognitiveLoad: { intrinsic: 1, extraneous: 1, germane: 1 } }, original);
    expect(asObject(proposal.content).cognitiveLoad).toEqual({ intrinsic: 1, extraneous: 1, germane: 1 });
  });

  it("rejects a field it does not know about instead of dropping it", () => {
    // A client sending `interactions` has to be told no, or it gets a pull request that did
    // nothing and no indication why.
    expect(() => buildTeamProposal(team, { interactions: [] }, original)).toThrow(ProposalError);
    expect(() => buildTeamProposal(team, { id: "renamed" }, original)).toThrow(ProposalError);
    expect(() => buildTeamProposal(team, { info: { type: "platform" } }, original)).toThrow(ProposalError);
  });

  it("rejects a change that would not validate", () => {
    expect(() =>
      buildTeamProposal(team, { cognitiveLoad: { intrinsic: 99, extraneous: 1, germane: 1 } }, original),
    ).toThrow(ProposalError);
    expect(() => buildTeamProposal(team, { info: { name: "" } }, original)).toThrow(ProposalError);
  });

  it("rejects an empty patch, and one that changes nothing", () => {
    expect(() => buildTeamProposal(team, {}, original)).toThrow(/must change something/);
    expect(() => buildTeamProposal(team, { info: { focus: team.doc.info.focus } }, original)).toThrow(
      /matches the document already/,
    );
  });

  it("produces a document that is already canonically formatted", () => {
    // So the pull request cannot fail `teamapi fmt --check` — a proposal opening a red PR would
    // put the person who used the dashboard in front of a failure they cannot fix.
    const proposal = buildTeamProposal(team, { info: { focus: "New focus" } }, original);
    const reproposed = buildTeamProposal(
      { ...team, doc: { ...team.doc, info: { ...team.doc.info, focus: "New focus" } } },
      { info: { focus: "Newer focus" } },
      proposal.content,
    );
    expect(reproposed.content).toBe(reproposed.content.trimStart());
  });

  it("replaces channels and search terms as lists", () => {
    const proposal = buildTeamProposal(
      team,
      { channels: [{ type: "slack", name: "checkout-team" }], searchTerms: [{ term: "basket" }] },
      original,
    );
    expect(asObject(proposal.content).channels).toEqual([{ type: "slack", name: "checkout-team" }]);
    expect(asObject(proposal.content).searchTerms).toEqual([{ term: "basket" }]);
  });
});

describe("proposalBranchName", () => {
  it("is stable for the same content and different for different content", () => {
    // Stable so proposing the same change twice updates one pull request instead of accumulating
    // near-identical ones.
    expect(proposalBranchName("t", "content")).toBe(proposalBranchName("t", "content"));
    expect(proposalBranchName("t", "content")).not.toBe(proposalBranchName("t", "other"));
    expect(proposalBranchName("t", "content")).toMatch(/^teamapi\/t-[a-z0-9]+$/);
  });
});

describe("proposalPullRequest", () => {
  it("titles a single change with the change itself", () => {
    const { title, body } = proposalPullRequest(
      { teamId: "stream-checkout", sourceUri: "x", content: "", summary: ["focus: a → b"] },
      "aoife@example.com",
    );
    expect(title).toBe("stream-checkout: focus: a → b");
    expect(body).toContain("aoife@example.com");
    expect(body).toContain("- focus: a → b");
  });

  it("counts them when there is more than one", () => {
    const { title } = proposalPullRequest({ teamId: "t", sourceUri: "x", content: "", summary: ["a", "b"] });
    expect(title).toBe("t: 2 changes");
  });
});

describe("repositoryPath", () => {
  it("makes an absolute resolver path relative to the repository", () => {
    expect(repositoryPath("/repo/examples/acme/teamapi.yml", "/repo")).toBe("examples/acme/teamapi.yml");
    expect(repositoryPath("/repo/a/teamapi.yml", "/repo/")).toBe("a/teamapi.yml");
  });

  it("refuses a document outside the configured root", () => {
    // Otherwise a `$ref` reaching outside the repository would write to a path that means
    // something entirely different inside it.
    expect(() => repositoryPath("/elsewhere/teamapi.yml", "/repo")).toThrow("not inside");
  });
});

describe("openTeamProposal", () => {
  const proposal = { teamId: "t", sourceUri: "/repo/teams/t/teamapi.yml", content: "id: t\n", summary: ["focus"] };
  const repo = { owner: "acme", repo: "org", rootDir: "/repo" };

  /** Records every request, and answers each GitHub endpoint the flow touches. */
  function stubGithub(overrides: Record<string, unknown> = {}): {
    client: GithubClient;
    calls: Array<{ method: string; url: string }>;
  } {
    const calls: Array<{ method: string; url: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        const method = init?.method ?? "GET";
        calls.push({ method, url });
        const key = Object.keys(overrides).find((fragment) => url.includes(fragment));
        const body = key ? overrides[key] : defaultFor(url);
        if (body === "404") return new Response("not found", { status: 404 });
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    return { client: new GithubClient({ token: "t" }), calls };
  }

  function defaultFor(url: string): unknown {
    if (url.includes("/pulls?")) return [];
    if (url.includes("/git/ref/heads/")) return { object: { sha: "basesha" } };
    if (url.includes("/contents/")) return { sha: "filesha" };
    if (url.endsWith("/repos/acme/org")) return { default_branch: "main" };
    return { number: 7, html_url: "https://github.com/acme/org/pull/7" };
  }

  it("creates a branch, writes the file, and opens a pull request", async () => {
    const { client, calls } = stubGithub({ "/git/ref/heads/teamapi": "404" });
    const opened = await openTeamProposal(client, proposal, repo);

    expect(opened.url).toBe("https://github.com/acme/org/pull/7");
    expect(opened.path).toBe("teams/t/teamapi.yml");
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/git/refs"))).toBe(true);
    expect(calls.some((call) => call.method === "PUT" && call.url.includes("/contents/teams/t/teamapi.yml"))).toBe(
      true,
    );
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/pulls"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("updates the existing pull request instead of opening a second one", async () => {
    const { client, calls } = stubGithub({
      "/pulls?": [{ number: 3, html_url: "https://github.com/acme/org/pull/3" }],
    });
    const opened = await openTeamProposal(client, proposal, repo);

    expect(opened.number).toBe(3);
    // The file is still written — the proposal may differ from what the branch holds — but no
    // second pull request is opened for it.
    expect(calls.some((call) => call.method === "PUT")).toBe(true);
    expect(calls.filter((call) => call.method === "POST" && call.url.includes("/pulls"))).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("does not re-create a branch that already exists", async () => {
    const { client, calls } = stubGithub();
    await openTeamProposal(client, proposal, repo);
    expect(calls.some((call) => call.method === "POST" && call.url.includes("/git/refs"))).toBe(false);
    vi.unstubAllGlobals();
  });
});
