import { GithubClient } from "../github/client";
import { OktaClient } from "../okta/client";
import { PaperclipClient } from "../paperclip/client";
import { PagerDutyClient } from "../pagerduty/client";
import { SlackClient } from "../slack/client";
import type { PaperclipAgent } from "../apply/paperclip-drift";

/**
 * Checks a live integration end to end: can we authenticate, does the read work, are the fields
 * we depend on there, and does pagination actually get followed.
 *
 * This exists because of a specific failure shape. Every one of these integrations degrades
 * silently rather than loudly — a rejected Slack token reads as an empty workspace and every
 * channel comes back `missing`; an Okta page-one stop makes everyone past the first batch look
 * like a leaver, which is a *blocking* finding about people who never left. Those are wrong
 * answers delivered confidently, and nothing downstream can tell.
 *
 * So the first question a user has when a drift report surprises them — "is my token even
 * right?" — deserves a command, not a guess.
 */

export type CheckStatus = "pass" | "fail" | "skip";

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorReport {
  integration: string;
  checks: DoctorCheck[];
}

export function reportFailed(report: DoctorReport): boolean {
  return report.checks.some((c) => c.status === "fail");
}

async function attempt(name: string, run: () => Promise<string>): Promise<DoctorCheck> {
  try {
    return { name, status: "pass", detail: await run() };
  } catch (err) {
    return { name, status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Proves pagination is followed without needing a large account.
 *
 * Asking for one item per page and getting more than one back can only happen if the next page
 * was fetched — no request counting, no mocking. With nothing to page through the check reports
 * `skip` rather than a pass it hasn't earned.
 */
async function paginationCheck(total: number, onePerPage: () => Promise<{ length: number }>): Promise<DoctorCheck> {
  if (total <= 1) {
    return {
      name: "pagination",
      status: "skip",
      detail: `only ${total} item(s) — nothing to page through`,
    };
  }
  try {
    const paged = await onePerPage();
    return paged.length === total
      ? { name: "pagination", status: "pass", detail: `followed to ${paged.length} item(s) at one per page` }
      : {
          name: "pagination",
          status: "fail",
          detail: `one page at a time returned ${paged.length} of ${total} — the next page was not followed`,
        };
  } catch (err) {
    return { name: "pagination", status: "fail", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** A check that can't run because a prerequisite failed, said plainly rather than as a pass. */
function blocked(name: string, why: string): DoctorCheck {
  return { name, status: "skip", detail: `not run: ${why}` };
}

export async function doctorSlack(client: SlackClient): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(await attempt("authenticate", () => client.verify()));

  if (checks[0]!.status === "fail") {
    return { integration: "slack", checks: [...checks, blocked("list channels", "authentication failed")] };
  }

  let channels: Awaited<ReturnType<SlackClient["listChannels"]>> = [];
  checks.push(
    await attempt("list channels", async () => {
      channels = await client.listChannels();
      return `${channels.length} channel(s) visible`;
    }),
  );

  checks.push(
    channels.length === 0
      ? { name: "channel shape", status: "skip", detail: "no channels to inspect" }
      : channels.every((c) => c.id && c.name)
        ? { name: "channel shape", status: "pass", detail: "every channel has an id and a name" }
        : { name: "channel shape", status: "fail", detail: "a channel came back with no id or no name" },
  );

  checks.push(await paginationCheck(channels.length, () => client.listChannels(1)));
  return { integration: "slack", checks };
}

export async function doctorPagerDuty(client: PagerDutyClient): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(await attempt("authenticate", () => client.verify()));

  if (checks[0]!.status === "fail") {
    return { integration: "pagerduty", checks: [...checks, blocked("list services", "authentication failed")] };
  }

  let services: Awaited<ReturnType<PagerDutyClient["listServices"]>> = [];
  checks.push(
    await attempt("list services", async () => {
      services = await client.listServices();
      return `${services.length} service(s) visible`;
    }),
  );

  // the whole point of the drift check is the responder count, so confirm policies resolved
  const withPolicy = services.filter((s) => s.escalationPolicy);
  checks.push(
    services.length === 0
      ? { name: "escalation policies", status: "skip", detail: "no services to inspect" }
      : withPolicy.length === 0
        ? {
            name: "escalation policies",
            status: "fail",
            detail: "no service resolved to an escalation policy — the responder count would always read as zero",
          }
        : {
            name: "escalation policies",
            status: "pass",
            detail: `${withPolicy.length}/${services.length} service(s) resolved a policy`,
          },
  );

  checks.push(await paginationCheck(services.length, () => client.listServices(1)));
  return { integration: "pagerduty", checks };
}

export async function doctorOkta(client: OktaClient): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(await attempt("authenticate", () => client.verify()));

  if (checks[0]!.status === "fail") {
    return { integration: "okta", checks: [...checks, blocked("list groups", "authentication failed")] };
  }

  let groups: Awaited<ReturnType<OktaClient["listGroups"]>> = [];
  checks.push(
    await attempt("list groups", async () => {
      groups = await client.listGroups();
      return `${groups.length} group(s) visible`;
    }),
  );

  // members are matched by address, so a group of people with no email reconciles against nothing
  const withMembers = groups.filter((g) => g.members.length > 0);
  checks.push(
    groups.length === 0
      ? { name: "member addresses", status: "skip", detail: "no groups to inspect" }
      : withMembers.length === 0
        ? {
            name: "member addresses",
            status: "fail",
            detail: "no group had a member with an address — every declared member would read as a leaver",
          }
        : {
            name: "member addresses",
            status: "pass",
            detail: `${withMembers.length}/${groups.length} group(s) have members with addresses`,
          },
  );

  checks.push(await paginationCheck(groups.length, () => client.listGroups(1)));
  return { integration: "okta", checks };
}

export async function doctorPaperclip(client: PaperclipClient, companyId: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  const reachable = await attempt("authenticate", async () => {
    const state = await client.verify(companyId);
    if (state === "unauthorized") throw new Error("token refused — check --token or PAPERCLIP_API_KEY");
    if (state === "no-such-company") throw new Error(`no company '${companyId}' at this URL`);
    return `company ${companyId} reachable`;
  });
  checks.push(reachable);

  if (reachable.status === "fail") {
    return { integration: "paperclip", checks: [...checks, blocked("list agents", "authentication failed")] };
  }

  let agents: PaperclipAgent[] = [];
  checks.push(
    await attempt("list agents", async () => {
      agents = await client.listAgents(companyId);
      return `${agents.length} agent(s) running`;
    }),
  );

  // attribution is what maps a running agent back to a team; without it every agent falls back to
  // slug matching, and anything created by hand reads as undeclared
  const attributed = agents.filter((a) => a.metadata?.teamapi?.team);
  checks.push(
    agents.length === 0
      ? { name: "team attribution", status: "skip", detail: "no agents to inspect" }
      : {
          name: "team attribution",
          status: "pass",
          detail:
            attributed.length === agents.length
              ? `all ${agents.length} agent(s) carry metadata.teamapi`
              : `${attributed.length}/${agents.length} carry metadata.teamapi; the rest fall back to slug matching`,
        },
  );

  // Paperclip's agents route returns the whole list in one response, so there is no cursor to
  // follow — and no way from here to tell a complete list from a silently truncated one
  checks.push({
    name: "pagination",
    status: "skip",
    detail: "the agents route is read in one request; Paperclip documents no cursor",
  });

  return { integration: "paperclip", checks };
}

export async function doctorGithub(client: GithubClient, org: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(await attempt("authenticate", () => client.verify()));

  if (checks[0]!.status === "fail") {
    return { integration: "github", checks: [...checks, blocked("list org teams", "authentication failed")] };
  }

  checks.push(
    await attempt("list org teams", async () => {
      const teams = await client.listOrgTeams(org);
      return `${teams.length} team(s) in ${org}`;
    }),
  );
  return { integration: "github", checks };
}

const MARK: Record<CheckStatus, string> = { pass: "✓", fail: "✗", skip: "–" };

export function formatDoctorReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.name.length));
  const lines = report.checks.map((c) => `  ${MARK[c.status]} ${c.name.padEnd(width)}  ${c.detail}`);
  const failed = report.checks.filter((c) => c.status === "fail").length;

  lines.unshift(`${report.integration}`);
  lines.push("");
  lines.push(failed === 0 ? "All checks passed." : `${failed} check(s) failed.`);
  return lines.join("\n");
}
