import { afterEach, describe, expect, it, vi } from "vitest";
import { GithubClient } from "../github/client";

function jsonResponse(body: unknown, init: { status?: number; link?: string } = {}): Response {
  const headers = new Headers();
  if (init.link) headers.set("link", init.link);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GithubClient", () => {
  it("lists org teams", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ slug: "platform-payments", name: "platform-payments", description: null }]));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GithubClient({ token: "t" });
    const teams = await client.listOrgTeams("acme");

    expect(teams).toEqual([{ slug: "platform-payments", name: "platform-payments", description: null }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/orgs/acme/teams?per_page=100");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("follows Link: rel=next pagination across multiple pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([{ login: "diego-alves" }], {
          link: '<https://api.github.com/orgs/acme/teams/x/members?per_page=100&page=2>; rel="next"',
        }),
      )
      .mockResolvedValueOnce(jsonResponse([{ login: "yuki-tanaka" }]));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GithubClient({ token: "t" });
    const members = await client.listTeamMembers("acme", "x");

    expect(members).toEqual([{ login: "diego-alves" }, { login: "yuki-tanaka" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws with status and body detail on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("team not found", { status: 404, statusText: "Not Found" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GithubClient({ token: "t" });
    await expect(client.setTeamMembership("acme", "ghost-team", "diego-alves")).rejects.toThrow(/404.*team not found/);
  });

  it("creates a team using the slug as its name, and returns undefined for a 204 response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ slug: "stream-billing", name: "stream-billing", description: "Billing" }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GithubClient({ token: "t" });
    const team = await client.createTeam("acme", { slug: "stream-billing", description: "Billing" });
    expect(team.slug).toBe("stream-billing");

    const [, createInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(createInit.body as string)).toEqual({ name: "stream-billing", description: "Billing", privacy: "closed" });

    const result = await client.removeTeamMembership("acme", "stream-billing", "diego-alves");
    expect(result).toBeUndefined();
  });

  it("respects a custom baseUrl for GitHub Enterprise Server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ login: "diego-alves", name: "Diego Alves", email: null }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new GithubClient({ token: "t", baseUrl: "https://ghe.acme.example/api/v3" });
    await client.getUser("diego-alves");

    expect(fetchMock).toHaveBeenCalledWith("https://ghe.acme.example/api/v3/users/diego-alves", expect.anything());
  });
});
