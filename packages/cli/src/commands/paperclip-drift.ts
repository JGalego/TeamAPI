import {
  buildOrgGraph,
  formatDriftReport,
  planPaperclipDrift,
  type PaperclipAgent,
} from "@jgalego/teamapi-core";
import { expandSeeds } from "../seeds";
import { warnUnresolved } from "../warn-unresolved";

export interface PaperclipDriftOptions {
  url: string;
  company: string;
  token?: string;
}

/** `GET /api/companies/{companyId}/agents` — Paperclip's documented list route. Auth is a bearer
 * token, the same shape its docs use for agent API keys and run JWTs. */
async function fetchAgents(options: PaperclipDriftOptions): Promise<PaperclipAgent[]> {
  const token = options.token ?? process.env.PAPERCLIP_API_KEY;
  if (!token) {
    throw new Error("No Paperclip token: pass --token or set PAPERCLIP_API_KEY");
  }
  const base = options.url.replace(/\/+$/, "");
  const url = `${base}/api/companies/${encodeURIComponent(options.company)}/agents`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Paperclip returned ${response.status} ${response.statusText} for ${url}`);
  }
  const body = (await response.json()) as unknown;
  const agents = Array.isArray(body) ? body : (body as { agents?: unknown[] }).agents;
  if (!Array.isArray(agents)) {
    throw new Error(`Unexpected response from ${url}: expected an array of agents`);
  }
  return agents as PaperclipAgent[];
}

export async function runPaperclipDrift(
  patterns: string[],
  options: PaperclipDriftOptions,
): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }
  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  let running: PaperclipAgent[];
  try {
    running = await fetchAgents(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const report = planPaperclipDrift(graph, options.company, running);
  console.log(formatDriftReport(report));

  // Exit non-zero only on a governance breach, so this can gate a required check without
  // ordinary drift — which is expected while Paperclip's org is editable from its UI — failing CI.
  return report.findings.some((f) => f.severity === "blocking") ? 1 : 0;
}
