import {
  doctorGithub,
  doctorOkta,
  doctorPagerDuty,
  doctorSlack,
  formatDoctorReport,
  GithubClient,
  OktaClient,
  PagerDutyClient,
  reportFailed,
  SlackClient,
  type DoctorReport,
} from "@jgalego/teamapi-core";

export type DoctorIntegration = "github" | "slack" | "pagerduty" | "okta";

export interface DoctorOptions {
  token?: string;
  url?: string;
  org?: string;
}

/** Each integration's token variable, so the error names the one the user needs. */
const TOKEN_ENV: Record<DoctorIntegration, string[]> = {
  github: ["GITHUB_TOKEN", "GH_TOKEN"],
  slack: ["SLACK_BOT_TOKEN"],
  pagerduty: ["PAGERDUTY_TOKEN"],
  okta: ["OKTA_TOKEN"],
};

function resolveToken(integration: DoctorIntegration, flag?: string): string | undefined {
  if (flag) return flag;
  for (const name of TOKEN_ENV[integration]) {
    if (process.env[name]) return process.env[name];
  }
  return undefined;
}

/**
 * Verifies a live integration: authentication, the read, the fields the drift checks depend on,
 * and whether pagination is really followed.
 *
 * Touches no `teamapi.yml` at all — this asks whether the connection works, not whether the org
 * graph agrees with it. Read-only against every provider.
 */
export async function runDoctor(integration: DoctorIntegration, options: DoctorOptions): Promise<number> {
  const token = resolveToken(integration, options.token);
  if (!token) {
    console.error(`A ${integration} token is required: pass --token or set ${TOKEN_ENV[integration].join("/")}.`);
    return 1;
  }

  let report: DoctorReport;
  switch (integration) {
    case "slack":
      report = await doctorSlack(new SlackClient({ token, baseUrl: options.url }));
      break;
    case "pagerduty":
      report = await doctorPagerDuty(new PagerDutyClient({ token, baseUrl: options.url }));
      break;
    case "okta":
      if (!options.url) {
        console.error("Okta needs an org URL: pass --url https://your-org.okta.com");
        return 1;
      }
      report = await doctorOkta(new OktaClient({ token, url: options.url }));
      break;
    case "github":
      if (!options.org) {
        console.error("GitHub needs an organization: pass --org <org>");
        return 1;
      }
      report = await doctorGithub(new GithubClient({ token, baseUrl: options.url }), options.org);
      break;
  }

  console.log(formatDoctorReport(report));
  return reportFailed(report) ? 1 : 0;
}
