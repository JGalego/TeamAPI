import { describe, expect, it } from "vitest";
import { executeGithubTeamsApply, formatApplyPlan, planGithubTeamsApply } from "../apply/github-teams";
import type { GithubClient, GithubTeam, GithubUser } from "../github/client";
import type { OrgGraph, ResolvedTeam } from "../model/org-graph";

function makeTeam(id: string, members: ResolvedTeam["doc"]["members"] = [], focus?: string): ResolvedTeam {
  return {
    id,
    sourceUri: `/${id}.yml`,
    doc: {
      teamApiVersion: "1.0.0" as const,
      id,
      info: { name: id, focus, type: "stream-aligned" as const },
      channels: [],
      searchTerms: [],
      services: [],
      roles: [],
      members,
      meetings: [],
      interactions: [],
      dependencies: [],
      agents: [],
      memory: [],
      specifications: [],
      steeringDocuments: [],
      prompts: [],
      playbooks: [],
      policies: [],
      knowledgeBase: [],
      workflows: [],
      sessions: [],
    },
  };
}

function makeGraph(teams: ResolvedTeam[]): OrgGraph {
  return {
    teams: new Map(teams.map((t) => [t.id, t])),
    edges: [],
    roleEdges: [],
    unresolved: [],
    meta: { resolvedAt: "2026-01-01T00:00:00.000Z", sourceRoots: [] },
  };
}

class FakeClient {
  createdTeams: Array<{ org: string; slug: string; description?: string }> = [];
  added: Array<{ org: string; teamSlug: string; login: string }> = [];
  removed: Array<{ org: string; teamSlug: string; login: string }> = [];

  constructor(
    private teams: GithubTeam[],
    private membersBySlug: Record<string, GithubUser[]>,
  ) {}

  listOrgTeams: GithubClient["listOrgTeams"] = async () => this.teams;
  listTeamMembers: GithubClient["listTeamMembers"] = async (_org, slug) => this.membersBySlug[slug] ?? [];
  createTeam: GithubClient["createTeam"] = async (org, input) => {
    this.createdTeams.push({ org, slug: input.slug, description: input.description });
    return { slug: input.slug, name: input.slug, description: input.description ?? null };
  };
  setTeamMembership: GithubClient["setTeamMembership"] = async (org, teamSlug, login) => {
    this.added.push({ org, teamSlug, login });
  };
  removeTeamMembership: GithubClient["removeTeamMembership"] = async (org, teamSlug, login) => {
    this.removed.push({ org, teamSlug, login });
  };
}

describe("planGithubTeamsApply", () => {
  it("plans a create for a team with no matching GitHub team, adding every resolvable member", async () => {
    const graph = makeGraph([
      makeTeam("stream-billing", [
        { id: "sofia-kowalczyk", name: "Sofia Kowalczyk", roleIds: [], githubUsername: "SofiaK" },
        { id: "no-github", name: "No Github", roleIds: [] },
      ]),
    ]);
    const client = new FakeClient([], {});

    const plan = await planGithubTeamsApply(graph, client, "meridian");

    expect(plan.teams).toEqual([
      {
        teamId: "stream-billing",
        action: "create",
        membersToAdd: ["sofiak"],
        membersToRemove: [],
        membersSkipped: ["no-github"],
      },
    ]);
  });

  it("plans an update that adds and removes logins to match the desired set", async () => {
    const graph = makeGraph([
      makeTeam("stream-billing", [{ id: "daniel-osei", name: "Daniel Osei", roleIds: [], githubUsername: "danielosei" }]),
    ]);
    const client = new FakeClient(
      [{ slug: "stream-billing", name: "stream-billing", description: null }],
      { "stream-billing": [{ login: "stale-user" }] },
    );

    const plan = await planGithubTeamsApply(graph, client, "meridian");

    expect(plan.teams).toEqual([
      {
        teamId: "stream-billing",
        action: "update",
        membersToAdd: ["danielosei"],
        membersToRemove: ["stale-user"],
        membersSkipped: [],
      },
    ]);
  });

  it("plans a noop when the GitHub team's members already match", async () => {
    const graph = makeGraph([
      makeTeam("stream-billing", [{ id: "daniel-osei", name: "Daniel Osei", roleIds: [], githubUsername: "danielosei" }]),
    ]);
    const client = new FakeClient(
      [{ slug: "stream-billing", name: "stream-billing", description: null }],
      { "stream-billing": [{ login: "danielosei" }] },
    );

    const plan = await planGithubTeamsApply(graph, client, "meridian");
    expect(plan.teams[0]!.action).toBe("noop");
  });
});

describe("formatApplyPlan", () => {
  it("renders a no-changes message when every team is a noop", () => {
    const text = formatApplyPlan({ org: "meridian", teams: [{ teamId: "x", action: "noop", membersToAdd: [], membersToRemove: [], membersSkipped: [] }] });
    expect(text).toBe("No changes. GitHub teams already match the org graph.");
  });

  it("renders create/add/remove/skip lines", () => {
    const text = formatApplyPlan({
      org: "meridian",
      teams: [
        {
          teamId: "stream-billing",
          action: "create",
          membersToAdd: ["danielosei"],
          membersToRemove: ["stale-user"],
          membersSkipped: ["no-github"],
        },
      ],
    });
    expect(text).toContain("+ create team 'stream-billing' in meridian");
    expect(text).toContain("+ add @danielosei to 'stream-billing'");
    expect(text).toContain("- remove @stale-user from 'stream-billing'");
    expect(text).toContain("! 'stream-billing': 1 member(s) skipped, no githubUsername set: no-github");
  });
});

describe("executeGithubTeamsApply", () => {
  it("creates the team, then adds and removes memberships per the plan", async () => {
    const graph = makeGraph([makeTeam("stream-billing", [], "Billing")]);
    const client = new FakeClient([], {});
    const plan = {
      org: "meridian",
      teams: [
        {
          teamId: "stream-billing",
          action: "create" as const,
          membersToAdd: ["danielosei"],
          membersToRemove: ["stale-user"],
          membersSkipped: [],
        },
      ],
    };

    await executeGithubTeamsApply(plan, graph, client);

    expect(client.createdTeams).toEqual([{ org: "meridian", slug: "stream-billing", description: "Billing" }]);
    expect(client.added).toEqual([{ org: "meridian", teamSlug: "stream-billing", login: "danielosei" }]);
    expect(client.removed).toEqual([{ org: "meridian", teamSlug: "stream-billing", login: "stale-user" }]);
  });

  it("skips team creation for an update/noop action", async () => {
    const graph = makeGraph([makeTeam("stream-billing")]);
    const client = new FakeClient([], {});
    const plan = {
      org: "meridian",
      teams: [{ teamId: "stream-billing", action: "update" as const, membersToAdd: [], membersToRemove: [], membersSkipped: [] }],
    };

    await executeGithubTeamsApply(plan, graph, client);
    expect(client.createdTeams).toEqual([]);
  });
});
