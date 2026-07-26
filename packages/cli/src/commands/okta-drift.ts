import {
  buildOrgGraph,
  formatOktaDrift,
  planOktaDrift,
  type DirectoryGroup,
  type DirectoryUser,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface OktaDriftOptions {
  url: string;
  token?: string;
  groupPrefix?: string;
}

interface RawGroup {
  id: string;
  profile?: { name?: string };
}

interface RawUser {
  status?: string;
  profile?: { email?: string; login?: string; displayName?: string; firstName?: string; lastName?: string };
}

/** Okta paginates with a `Link: <...>; rel="next"` header rather than a cursor in the body. */
async function paged<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = url;
  while (next) {
    const res: Response = await fetch(next, {
      headers: { Authorization: `SSWS ${token}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Okta returned ${res.status} ${res.statusText} for ${next}`);
    out.push(...((await res.json()) as T[]));
    next = (res.headers.get("link") ?? "")
      .split(",")
      .map((part) => part.match(/<([^>]+)>;\s*rel="next"/)?.[1])
      .find(Boolean);
  }
  return out;
}

function toUser(raw: RawUser): DirectoryUser | null {
  const email = raw.profile?.email ?? raw.profile?.login;
  if (!email) return null;
  const name = raw.profile?.displayName ?? [raw.profile?.firstName, raw.profile?.lastName].filter(Boolean).join(" ");
  return { email, displayName: name || undefined, status: raw.status };
}

async function fetchGroups(options: OktaDriftOptions): Promise<DirectoryGroup[]> {
  const token = options.token ?? process.env.OKTA_TOKEN;
  if (!token) throw new Error("No Okta token: pass --token or set OKTA_TOKEN");
  const base = options.url.replace(/\/+$/, "");

  const groups = await paged<RawGroup>(`${base}/api/v1/groups?limit=200`, token);
  const out: DirectoryGroup[] = [];
  for (const group of groups) {
    const name = group.profile?.name;
    if (!name) continue;
    const users = await paged<RawUser>(`${base}/api/v1/groups/${group.id}/users?limit=200`, token);
    out.push({ name, members: users.map(toUser).filter((u): u is DirectoryUser => u !== null) });
  }
  return out;
}

/** Reports where declared membership and the directory disagree. Exits non-zero only when a
 * deactivated account is still listed on a team — the finding that makes the org chart name
 * someone who has left as accountable for a service. */
export async function runOktaDrift(patterns: string[], options: OktaDriftOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  let groups: DirectoryGroup[];
  try {
    groups = await fetchGroups(options);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  const report = planOktaDrift(graph, groups, { groupPrefix: options.groupPrefix });
  console.log(formatOktaDrift(report));
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
