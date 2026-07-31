import {
  buildOrgGraph,
  formatDriftReport,
  PaperclipClient,
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

export async function runPaperclipDrift(patterns: string[], options: PaperclipDriftOptions): Promise<number> {
  const seeds = await expandSeeds(patterns);
  if (seeds.length === 0) {
    console.error(`No files matched: ${patterns.join(", ")}`);
    return 1;
  }
  const token = options.token ?? process.env.PAPERCLIP_API_KEY;
  if (!token) {
    console.error("A Paperclip token is required: pass --token or set PAPERCLIP_API_KEY.");
    return 1;
  }

  const graph = await buildOrgGraph({ seedUris: seeds, allowPartial: true });
  warnUnresolved(graph);

  let running: PaperclipAgent[];
  try {
    running = await new PaperclipClient({ token, url: options.url }).listAgents(options.company);
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
