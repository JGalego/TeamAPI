import { describe, expect, it } from "vitest";
import { TeamApiDocumentSchema } from "@jgalego/teamapi-schema";
import { importGithubOrg } from "../import/github-org";
import type { GithubClient, GithubRepo, GithubTeam, GithubUser, GithubUserProfile } from "../github/client";

class FakeClient {
  constructor(
    private teams: GithubTeam[],
    private membersBySlug: Record<string, GithubUser[]>,
    private reposBySlug: Record<string, GithubRepo[]>,
    private profilesByLogin: Record<string, GithubUserProfile>,
  ) {}

  listOrgTeams: GithubClient["listOrgTeams"] = async () => this.teams;
  listTeamMembers: GithubClient["listTeamMembers"] = async (_org, slug) => this.membersBySlug[slug] ?? [];
  listTeamRepos: GithubClient["listTeamRepos"] = async (_org, slug) => this.reposBySlug[slug] ?? [];
  getUser: GithubClient["getUser"] = async (login) => {
    const profile = this.profilesByLogin[login];
    if (!profile) throw new Error(`no profile stubbed for ${login}`);
    return profile;
  };
}

describe("importGithubOrg", () => {
  it("produces one schema-valid document per team, with members enriched from user profiles", async () => {
    const client = new FakeClient(
      [{ slug: "stream-checkout", name: "Stream Checkout", description: "Cart and checkout" }],
      { "stream-checkout": [{ login: "diego-alves" }] },
      { "stream-checkout": [{ name: "checkout-api", html_url: "https://github.com/acme/checkout-api" }] },
      { "diego-alves": { login: "diego-alves", name: "Diego Alves", email: "diego@acme.example" } },
    );

    const [imported] = await importGithubOrg(client, "acme");

    expect(imported!.teamId).toBe("stream-checkout");
    expect(imported!.document).toMatchObject({
      teamApiVersion: "1.0.0",
      id: "stream-checkout",
      info: { name: "Stream Checkout", focus: "Cart and checkout", type: "stream-aligned" },
      roles: [],
      members: [{ id: "diego-alves", name: "Diego Alves", contact: "diego@acme.example", githubUsername: "diego-alves", roleIds: [] }],
      services: [{ name: "checkout-api", repository: "https://github.com/acme/checkout-api" }],
    });

    expect(() => TeamApiDocumentSchema.parse(imported!.document)).not.toThrow();
  });

  it("falls back to the login when no user profile is available, and omits services when there are none", async () => {
    const client = new FakeClient(
      [{ slug: "enabling-devex", name: "Enabling DevEx", description: null }],
      { "enabling-devex": [{ login: "marta-kowalski" }] },
      {},
      {},
    );

    const [imported] = await importGithubOrg(client, "acme");

    expect(imported!.document["services"]).toBeUndefined();
    expect(imported!.document["members"]).toEqual([
      { id: "marta-kowalski", name: "marta-kowalski", githubUsername: "marta-kowalski", roleIds: [] },
    ]);
    expect(() => TeamApiDocumentSchema.parse(imported!.document)).not.toThrow();
  });

  it("returns teams sorted by slug", async () => {
    const client = new FakeClient(
      [
        { slug: "zeta-team", name: "Zeta", description: null },
        { slug: "alpha-team", name: "Alpha", description: null },
      ],
      {},
      {},
      {},
    );

    const imported = await importGithubOrg(client, "acme");
    expect(imported.map((t) => t.teamId)).toEqual(["alpha-team", "zeta-team"]);
  });
});
